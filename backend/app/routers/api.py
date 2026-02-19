"""API routes for KubeBeaver."""
import json
import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

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
    CreateIncidentRequest,
    UpdateIncidentRequest,
    CreateIncidentFromScanRequest,
    CreateIncidentFromAnalysisRequest,
    AddIncidentItemRequest,
    ExportIncidentRequest,
    IncidentListItem,
    IncidentDetail,
    CreateScheduleRequest,
    UpdateScheduleRequest,
    ScheduleListItem,
)
from app.k8s_client import list_contexts, list_namespaces, list_resources, check_connection
from app.analyzer import run_analysis
from app.history import save_analysis, list_analyses, get_analysis, delete_analysis, init_db
from app.scan_service import execute_and_save_scan, list_scans as list_scans_svc, get_scan as get_scan_svc
from app.compare_service import run_compare
from app.incident_service import (
    create_incident,
    update_incident,
    create_incident_from_scan,
    create_incident_from_analysis,
    add_incident_item,
    add_incident_note,
    list_incidents,
    get_incident_with_timeline,
    export_incident,
    delete_incident,
)
from app.schedule_service import (
    create_schedule,
    list_schedules as list_schedules_svc,
    get_schedule as get_schedule_svc,
    update_schedule as update_schedule_svc,
    delete_schedule as delete_schedule_svc,
)
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
async def get_namespaces(context: str | None = None, no_cache: bool = False) -> list[str]:
    ctx = context if context and context.strip() else None
    key = cache_key("namespaces", ctx or "")
    logger.info("get_namespaces called with context=%s, cache_key=%s, no_cache=%s", ctx, key, no_cache)
    
    if not no_cache:
        cached = await cache_get(key)
        if cached is not None:
            logger.info("Returning cached namespaces for context=%s, count=%d", ctx, len(cached))
            return cached
    
    try:
        logger.info("Loading namespaces from Kubernetes for context=%s", ctx)
        data = list_namespaces(context=ctx)
        logger.info("Loaded %d namespaces for context=%s: %s", len(data), ctx, data[:5] if data else [])
        logger.info("Full namespaces list: %s", data)
        await cache_set(key, data, settings.cache_ttl_namespaces)
        logger.info("Returning %d namespaces to client", len(data))
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
async def history(limit: int = 50, context: str | None = None) -> list[dict[str, Any]]:
    """List recent analyses, optionally filtered by context."""
    return await list_analyses(limit=limit, context=context)


@router.get("/history/{analysis_id}")
async def history_get(analysis_id: str) -> dict[str, Any]:
    row = await get_analysis(analysis_id)
    if not row:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return row


@router.delete("/history/{analysis_id}")
async def history_delete(analysis_id: str) -> dict[str, str]:
    """Delete an analysis by ID."""
    deleted = await delete_analysis(analysis_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return {"message": "Analysis deleted successfully"}


@router.get("/analysis/{analysis_id}/explain")
async def analysis_explain(analysis_id: str) -> dict[str, Any]:
    """Return explainability slice for an analysis: heuristics, why, uncertain."""
    row = await get_analysis(analysis_id)
    if not row:
        raise HTTPException(status_code=404, detail="Analysis not found")
    aj = row.get("analysis_json") or {}
    if isinstance(aj, str):
        try:
            aj = json.loads(aj)
        except json.JSONDecodeError:
            aj = {}
    return {
        "analysis_id": analysis_id,
        "heuristics": aj.get("heuristics", []),
        "why": aj.get("why", []),
        "uncertain": aj.get("uncertain", []),
    }


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


# --- Incidents ---


@router.post("/incidents", status_code=201)
async def incidents_create(req: CreateIncidentRequest) -> dict[str, str]:
    incident_id = await create_incident(
        title=req.title,
        description=req.description,
        severity=req.severity,
        tags=req.tags or None,
    )
    return {"id": incident_id}


@router.patch("/incidents/{incident_id}")
async def incidents_update(incident_id: str, req: UpdateIncidentRequest) -> IncidentDetail:
    """Update incident fields."""
    # Validate enums
    if req.status is not None and req.status not in ("open", "mitigating", "resolved"):
        raise HTTPException(status_code=400, detail=f"Invalid status: {req.status}. Must be one of: open, mitigating, resolved")
    if req.severity is not None and req.severity not in ("info", "low", "medium", "high", "critical"):
        raise HTTPException(status_code=400, detail=f"Invalid severity: {req.severity}. Must be one of: info, low, medium, high, critical")
    
    updated = await update_incident(
        incident_id=incident_id,
        title=req.title,
        description=req.description,
        status=req.status,
        severity=req.severity,
        tags=req.tags,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Incident not found")
    row = await get_incident_with_timeline(incident_id)
    if not row:
        raise HTTPException(status_code=404, detail="Incident not found")
    return IncidentDetail(**row)


@router.post("/incidents/from-scan", status_code=201)
async def incidents_from_scan(req: CreateIncidentFromScanRequest) -> IncidentDetail:
    """Create incident from scan with scan as first item."""
    # Validate severity if provided
    if req.severity is not None and req.severity not in ("info", "low", "medium", "high", "critical"):
        raise HTTPException(status_code=400, detail=f"Invalid severity: {req.severity}. Must be one of: info, low, medium, high, critical")
    
    incident = await create_incident_from_scan(
        scan_id=req.scan_id,
        title=req.title,
        severity=req.severity,
    )
    if not incident:
        raise HTTPException(status_code=404, detail="Scan not found")
    return IncidentDetail(**incident)


@router.post("/incidents/from-analysis", status_code=201)
async def incidents_from_analysis(req: CreateIncidentFromAnalysisRequest) -> IncidentDetail:
    """Create incident from analysis with analysis as first item."""
    # Validate severity if provided
    if req.severity is not None and req.severity not in ("info", "low", "medium", "high", "critical"):
        raise HTTPException(status_code=400, detail=f"Invalid severity: {req.severity}. Must be one of: info, low, medium, high, critical")
    
    incident = await create_incident_from_analysis(
        analysis_id=req.analysis_id,
        title=req.title,
        severity=req.severity,
    )
    if not incident:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return IncidentDetail(**incident)


@router.post("/incidents/{incident_id}/add", status_code=201)
async def incidents_add_item(incident_id: str, req: AddIncidentItemRequest) -> dict[str, Any]:
    item_id = await add_incident_item(incident_id, item_type=req.type, ref_id=req.ref_id)
    if item_id is None:
        raise HTTPException(status_code=404, detail="Incident not found")
    return {"id": item_id}


@router.get("/incidents", response_model=list[IncidentListItem])
async def incidents_list(limit: int = 50) -> list[IncidentListItem]:
    items = await list_incidents(limit=limit)
    return [IncidentListItem(**r) for r in items]


@router.get("/incidents/{incident_id}", response_model=IncidentDetail)
async def incidents_get(incident_id: str) -> IncidentDetail:
    row = await get_incident_with_timeline(incident_id)
    if not row:
        raise HTTPException(status_code=404, detail="Incident not found")
    return IncidentDetail(**row)


@router.post("/incidents/{incident_id}/export")
async def incidents_export(incident_id: str, req: ExportIncidentRequest) -> Response:
    result = await export_incident(incident_id, fmt=req.format)
    if result is None:
        raise HTTPException(status_code=404, detail="Incident not found")
    content, media_type = result
    return Response(content=content, media_type=media_type)


@router.delete("/incidents/{incident_id}")
async def incidents_delete(incident_id: str) -> dict[str, str]:
    """Delete an incident by ID."""
    deleted = await delete_incident(incident_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Incident not found")
    return {"message": "Incident deleted successfully"}


@router.post("/incidents/{incident_id}/notes", status_code=201)
async def incidents_add_note(incident_id: str, body: dict[str, Any]) -> dict[str, str]:
    content = (body.get("content") or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="content required")
    note_id = await add_incident_note(incident_id, content=content)
    if note_id is None:
        raise HTTPException(status_code=404, detail="Incident not found")
    return {"id": note_id}


# --- Schedules ---


def _validate_cron(cron: str) -> None:
    parts = cron.strip().split()
    if len(parts) != 5:
        raise HTTPException(status_code=400, detail="cron must have 5 parts (e.g. '0 * * * *' for hourly)")


@router.post("/schedules", status_code=201)
async def schedules_create(req: CreateScheduleRequest) -> dict[str, str]:
    if req.scope not in ("namespace", "cluster"):
        raise HTTPException(status_code=400, detail="scope must be 'namespace' or 'cluster'")
    if req.scope == "namespace" and not (req.namespace and req.namespace.strip()):
        raise HTTPException(status_code=400, detail="namespace required when scope is 'namespace'")
    _validate_cron(req.cron)
    context = req.context if req.context and req.context.strip() else None
    namespace = req.namespace if req.namespace and req.namespace.strip() else None
    sid = await create_schedule(
        context=context,
        scope=req.scope,
        namespace=namespace,
        cron=req.cron.strip(),
        enabled=req.enabled,
    )
    return {"id": sid}


@router.get("/schedules", response_model=list[ScheduleListItem])
async def schedules_list(limit: int = 100) -> list[ScheduleListItem]:
    items = await list_schedules_svc(limit=limit)
    return [ScheduleListItem(**r) for r in items]


@router.get("/schedules/{schedule_id}", response_model=ScheduleListItem)
async def schedules_get(schedule_id: str) -> ScheduleListItem:
    row = await get_schedule_svc(schedule_id)
    if not row:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return ScheduleListItem(**row)


@router.put("/schedules/{schedule_id}", response_model=ScheduleListItem)
async def schedules_update(schedule_id: str, req: UpdateScheduleRequest) -> ScheduleListItem:
    if req.scope is not None and req.scope not in ("namespace", "cluster"):
        raise HTTPException(status_code=400, detail="scope must be 'namespace' or 'cluster'")
    cron_val: str | None = None
    if req.cron is not None:
        _validate_cron(req.cron)
        cron_val = req.cron.strip()
    context_val = (req.context or "").strip() if req.context is not None else None
    namespace_val = (req.namespace or "").strip() if req.namespace is not None else None
    ok = await update_schedule_svc(
        schedule_id,
        context=context_val,
        scope=req.scope,
        namespace=namespace_val,
        cron=cron_val,
        enabled=req.enabled,
    )
    if not ok:
        raise HTTPException(status_code=404, detail="Schedule not found")
    row = await get_schedule_svc(schedule_id)
    return ScheduleListItem(**row)


@router.delete("/schedules/{schedule_id}", status_code=204)
async def schedules_delete(schedule_id: str) -> None:
    ok = await delete_schedule_svc(schedule_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Schedule not found")
