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
    TargetKind,
    TruncationReport,
)
from app.k8s_client import list_contexts, list_namespaces, list_resources, check_connection
from app.analyzer import run_analysis
from app.history import save_analysis, list_analyses, get_analysis, init_db
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
    return HealthResponse(
        status="ok",
        kube_connected=kube,
        llm_configured=llm,
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
