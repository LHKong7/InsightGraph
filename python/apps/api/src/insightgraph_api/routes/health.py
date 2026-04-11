from __future__ import annotations

from fastapi import APIRouter, Request

router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check(request: Request) -> dict:
    """Check service health including Neo4j connectivity."""
    neo4j_ok = False
    try:
        conn = request.app.state.neo4j
        await conn.verify_connectivity()
        neo4j_ok = True
    except Exception:
        pass

    return {
        "status": "healthy" if neo4j_ok else "degraded",
        "neo4j": "connected" if neo4j_ok else "disconnected",
    }
