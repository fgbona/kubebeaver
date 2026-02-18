"""API routes for KubeBeaver."""
import logging
from typing import Any

from fastapi import APIRouter, HTTPException

from app.config import settings
from app.models import (
    AnalyzeRequest,
    AnalyzeResponse,
    AnalysisJson,
    HealthResponse,
    ResourceItem,
    ScanRequest,
    ScanResponse,
    ScanListItem,
    ScanFindingItem,
    TargetKind,
    TruncationReport,
    CompareRequest,
    CompareResponse,
    CompareChangeItem,
)
from app.k8s_client import list_contexts, list_namespaces, list_resources, check_connection
from app.analyzer import run_analysis
from app.history import save_analysis, list_analyses, get_analysis, init_db
from app.scan_service import execute_and_save_scan, list_scans as list_scans_svc, get_scan as get_scan_svc
from app.compare_service import run_compare
from app.llm import get_llm_provider
from app.cache import cache_key, get as cache_get, set as cache_set

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["api"])


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    kube = False
    try:
        kube = check_connection(None)
    except Exception:
        pass
    llm = get_llm_provider().is_configured
    provider = settings.llm_provider if llm else ""  # groq | openai_compatible
    return HealthResponse(
        status="ok",
        kube_connected=kube,
        llm_configured=llm,
        llm_provider=provider,
    )


@router.get("/contexts")
async def get_contexts() -> list[dict[str, Any]]:
    key = cache_key("contexts")
    cached = await cache_get(key)
    if cached is not None:
        return cached
    data = list_contexts()
    await cache_set(key, data, settings.cache_ttl_contexts)
    return data


@router.get("/namespaces")
async def get_namespaces(context: str | None = None) -> list[str]:
    ctx = context if context and context.strip() else None
    key = cache_key("namespaces", ctx or "")
    cached = await cache_get(key)
    if cached is not None:
        return cached
    try:
        data = list_namespaces(context=ctx)
        await cache_set(key, data, settings.cache_ttl_namespaces)
        return data
    except Exception as e:
        logger.warning("list_namespaces failed: %s", e)
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/resources", response_model=list[ResourceItem])
async def get_resources(
    namespace: str | None = None,
    kind: str = "Pod",
    context: str | None = None,
) -> list[ResourceItem]:
    if kind not in ("Pod", "Deployment", "StatefulSet", "Node"):
        raise HTTPException(status_code=400, detail="kind must be Pod, Deployment, StatefulSet, or Node")
    # Convert empty strings to None
    ns = namespace if namespace and namespace.strip() else None
    ctx = context if context and context.strip() else None
    if kind != "Node" and not ns:
        raise HTTPException(status_code=400, detail="namespace required for Pod, Deployment, StatefulSet")
    key = cache_key("resources", ctx or "", ns or "", kind)
    cached = await cache_get(key)
    if cached is not None:
        return [ResourceItem(**r) for r in cached]
    try:
        items = list_resources(kind=kind, namespace=ns, context=ctx)
        result = [ResourceItem(name=r["name"], namespace=r.get("namespace"), kind=r["kind"]) for r in items]
        await cache_set(key, [r.model_dump() for r in result], settings.cache_ttl_resources)
        return result
    except Exception as e:
        logger.warning("list_resources failed: %s", e)
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze(req: AnalyzeRequest) -> AnalyzeResponse:
    if req.kind != TargetKind.Node and not req.namespace:
        raise HTTPException(status_code=400, detail="namespace required for Pod, Deployment, StatefulSet")
    analyze_key = cache_key(
        "analyze",
        req.context or "",
        req.namespace or "",
        req.kind.value,
        req.name,
        str(req.include_previous_logs),
    )
    cached = await cache_get(analyze_key)
    if cached is not None:
        return AnalyzeResponse(**cached)
    try:
        analysis_dict, evidence, trunc_report, tokens_used, response_time_ms, err = await run_analysis(
            kind=req.kind.value,
            namespace=req.namespace,
            name=req.name,
            context=req.context,
            include_previous_logs=req.include_previous_logs,
        )
    except Exception as e:
        logger.exception("run_analysis failed: %s", e)
        return AnalyzeResponse(
            analysis_json=AnalysisJson(),
            analysis_markdown="",
            evidence={},
            truncation_report=TruncationReport(),
            tokens_used=0,
            response_time_ms=0,
            error=str(e),
        )
    if err:
        # Still save to history with error
        await save_analysis(
            context=req.context,
            namespace=req.namespace,
            kind=req.kind.value,
            name=req.name,
            analysis_json=analysis_dict or {},
            analysis_markdown="",
            evidence=evidence,
            error=err,
        )
        return AnalyzeResponse(
            analysis_json=AnalysisJson(**analysis_dict) if analysis_dict else AnalysisJson(),
            analysis_markdown="",
            evidence=evidence,
            truncation_report=trunc_report,
            tokens_used=tokens_used,
            response_time_ms=response_time_ms,
            error=err,
        )
    analysis_json = AnalysisJson(**analysis_dict)
    from app.analyzer import _json_to_markdown
    markdown = _json_to_markdown(analysis_json)
    analysis_id = await save_analysis(
        context=req.context,
        namespace=req.namespace,
        kind=req.kind.value,
        name=req.name,
        analysis_json=analysis_dict,
        analysis_markdown=markdown,
        evidence=evidence,
        error=None,
    )
    response = AnalyzeResponse(
        analysis_json=analysis_json,
        analysis_markdown=markdown,
        evidence=evidence,
        truncation_report=trunc_report,
        tokens_used=tokens_used,
        response_time_ms=response_time_ms,
        error=None,
    )
    await cache_set(analyze_key, response.model_dump(), settings.cache_ttl_analyze)
    return response


@router.get("/history")
async def history(limit: int = 50) -> list[dict[str, Any]]:
    return await list_analyses(limit=limit)


@router.get("/history/{analysis_id}")
async def history_get(analysis_id: str) -> dict[str, Any]:
    row = await get_analysis(analysis_id)
    if not row:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return row


@router.post("/compare", response_model=CompareResponse)
async def compare_post(req: CompareRequest) -> CompareResponse:
    result = await run_compare(req.analysis_id_a, req.analysis_id_b)
    if result.get("error"):
        status = 404 if "not found" in (result["error"] or "").lower() else 400
        raise HTTPException(status_code=status, detail=result["error"])
    return CompareResponse(
        diff_summary=result["diff_summary"],
        changes=[CompareChangeItem(**c) for c in result["changes"]],
        likely_reasoning=result["likely_reasoning"],
        analysis_a=result["analysis_a"],
        analysis_b=result["analysis_b"],
        error=None,
    )


# --- Scan ---


@router.post("/scan", response_model=ScanResponse)
async def scan_post(req: ScanRequest) -> ScanResponse:
    if req.scope not in ("namespace", "cluster"):
        raise HTTPException(status_code=400, detail="scope must be 'namespace' or 'cluster'")
    if req.scope == "namespace" and not (req.namespace and req.namespace.strip()):
        raise HTTPException(status_code=400, detail="namespace required when scope is 'namespace'")
    context = req.context if req.context and req.context.strip() else None
    namespace = req.namespace if req.namespace and req.namespace.strip() else None
    try:
        scan_id, summary_markdown, findings, counts, scan_error, duration_ms = await execute_and_save_scan(
            context=context,
            scope=req.scope,
            namespace=namespace,
            include_logs=req.include_logs,
        )
    except Exception as e:
        logger.exception("execute_and_save_scan failed: %s", e)
        raise HTTPException(status_code=502, detail=str(e))
    # Build response with finding ids from persisted scan (we don't have them from save_scan_run)
    scan_row = await get_scan_svc(scan_id)
    finding_items = [
        ScanFindingItem(
            id=f["id"],
            severity=f["severity"],
            category=f["category"],
            title=f["title"],
            description=f.get("description"),
            affected_refs=f.get("affected_refs") or [],
            evidence_refs=f.get("evidence_refs") or [],
            suggested_commands=f.get("suggested_commands") or [],
            evidence_snippet=f.get("evidence_snippet"),
            occurred_at=f.get("occurred_at"),
        )
        for f in (scan_row.get("findings") or [])
    ]
    return ScanResponse(
        id=scan_id,
        created_at=scan_row.get("created_at"),
        summary_markdown=summary_markdown,
        error=scan_error,
        findings=finding_items,
        counts=counts,
        duration_ms=duration_ms,
    )


@router.get("/scans", response_model=list[ScanListItem])
async def scans_list(limit: int = 50) -> list[ScanListItem]:
    items = await list_scans_svc(limit=limit)
    return [ScanListItem(**r) for r in items]


@router.get("/scans/{scan_id}")
async def scan_get(scan_id: str) -> dict[str, Any]:
    row = await get_scan_svc(scan_id)
    if not row:
        raise HTTPException(status_code=404, detail="Scan not found")
    return row
