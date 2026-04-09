from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from insightgraph_graph.reader import GraphReader

router = APIRouter(prefix="/api/v1", tags=["query"])


def _get_reader(request: Request) -> GraphReader:
    return GraphReader(request.app.state.neo4j)


@router.get("/entities/search")
async def search_entities(
    request: Request,
    q: str = "",
    type: str | None = None,
    limit: int = 50,
) -> dict:
    """Search for entities by name and optional type filter."""
    reader = _get_reader(request)
    entities = await reader.find_entities(name=q or None, entity_type=type, limit=limit)
    return {"entities": entities, "count": len(entities)}


@router.get("/entities/{entity_id}")
async def get_entity(request: Request, entity_id: str) -> dict:
    """Get a specific entity by ID."""
    reader = _get_reader(request)
    entity = await reader.get_entity(entity_id)
    if not entity:
        raise HTTPException(404, f"Entity {entity_id} not found")
    return entity


@router.get("/entities/{entity_id}/claims")
async def get_entity_claims(request: Request, entity_id: str) -> dict:
    """Get all claims about an entity."""
    reader = _get_reader(request)
    entity = await reader.get_entity(entity_id)
    if not entity:
        raise HTTPException(404, f"Entity {entity_id} not found")
    entity_name = entity.get("canonical_name") or entity.get("name", "")
    claims = await reader.get_claims_about(entity_name)
    return {"entity_id": entity_id, "claims": claims, "count": len(claims)}


@router.get("/entities/{entity_id}/metrics")
async def get_entity_metrics(
    request: Request,
    entity_id: str,
    metric_name: str | None = None,
) -> dict:
    """Get metric values for an entity."""
    reader = _get_reader(request)
    entity = await reader.get_entity(entity_id)
    if not entity:
        raise HTTPException(404, f"Entity {entity_id} not found")
    entity_name = entity.get("canonical_name") or entity.get("name", "")
    metrics = await reader.get_metric_history(metric_name or "", entity_name)
    return {"entity_id": entity_id, "metrics": metrics, "count": len(metrics)}


@router.get("/claims/{claim_id}/evidence")
async def get_claim_evidence(request: Request, claim_id: str) -> dict:
    """Get the source evidence for a claim."""
    reader = _get_reader(request)
    evidence = await reader.find_evidence_for_claim(claim_id)
    return {"claim_id": claim_id, "evidence": evidence, "count": len(evidence)}


@router.get("/subgraph/question")
async def get_subgraph(request: Request, q: str = "") -> dict:
    """Retrieve a relevant subgraph for a question."""
    if not q:
        raise HTTPException(400, "Query parameter 'q' is required")
    reader = _get_reader(request)
    # Find entities matching the question, then get subgraph
    entities = await reader.find_entities(name=q, limit=3)
    if not entities:
        return {"nodes": [], "edges": []}
    top_id = entities[0].get("entity_id", "")
    return await reader.get_subgraph(top_id, depth=2)


@router.get("/reports")
async def list_reports(request: Request) -> dict:
    """List all ingested reports."""
    reader = _get_reader(request)
    reports = await reader.list_reports()
    return {"reports": reports, "count": len(reports)}


@router.get("/reports/{report_id}")
async def get_report(request: Request, report_id: str) -> dict:
    """Get a specific report by ID."""
    reader = _get_reader(request)
    report = await reader.get_report(report_id)
    if not report:
        raise HTTPException(404, f"Report {report_id} not found")
    return report
