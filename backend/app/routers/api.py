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
    return list_contexts()


@router.get("/namespaces")
async def get_namespaces(context: str | None = None) -> list[str]:
    try:
        # Convert empty string to None
        ctx = context if context and context.strip() else None
        return list_namespaces(context=ctx)
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
    try:
        items = list_resources(kind=kind, namespace=ns, context=ctx)
        return [ResourceItem(name=r["name"], namespace=r.get("namespace"), kind=r["kind"]) for r in items]
    except Exception as e:
        logger.warning("list_resources failed: %s", e)
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze(req: AnalyzeRequest) -> AnalyzeResponse:
    if req.kind != TargetKind.Node and not req.namespace:
        raise HTTPException(status_code=400, detail="namespace required for Pod, Deployment, StatefulSet")
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
    return AnalyzeResponse(
        analysis_json=analysis_json,
        analysis_markdown=markdown,
        evidence=evidence,
        truncation_report=trunc_report,
        tokens_used=tokens_used,
        response_time_ms=response_time_ms,
        error=None,
    )


@router.get("/history")
async def history(limit: int = 50) -> list[dict[str, Any]]:
    return await list_analyses(limit=limit)


@router.get("/history/{analysis_id}")
async def history_get(analysis_id: str) -> dict[str, Any]:
    row = await get_analysis(analysis_id)
    if not row:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return row
