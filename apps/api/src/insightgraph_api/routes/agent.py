from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from insightgraph_agent.orchestrator import AgentResponse, Orchestrator
from insightgraph_agent.session import SessionManager
from insightgraph_graph.reader import GraphReader
from insightgraph_retriever.graph_retriever import GraphRetriever
from insightgraph_retriever.tools import AgentTools

router = APIRouter(prefix="/api/v1", tags=["agent"])

# Shared session manager (in-memory for MVP)
_session_manager = SessionManager()


def _build_orchestrator(request: Request) -> Orchestrator:
    settings = request.app.state.settings
    conn = request.app.state.neo4j

    reader = GraphReader(conn)
    graph_retriever = GraphRetriever(reader)
    agent_tools = AgentTools(graph_retriever)
    orchestrator = Orchestrator(
        tools=agent_tools,
        model=settings.llm_model,
        api_key=settings.llm_api_key,
    )
    orchestrator._session_manager = _session_manager
    return orchestrator


class QuestionRequest(BaseModel):
    question: str
    report_id: str | None = None
    session_id: str | None = None


@router.post("/agent/query", response_model=AgentResponse)
async def ask_question(request: Request, body: QuestionRequest) -> AgentResponse:
    """Ask a question about ingested reports using the full agent pipeline.

    Optionally pass a session_id to maintain conversation context.
    """
    orchestrator = _build_orchestrator(request)
    return await orchestrator.query(body.question, session_id=body.session_id)


# --- Session management ---


@router.post("/sessions")
async def create_session() -> dict:
    """Create a new conversation session."""
    session = _session_manager.create_session()
    return {"session_id": session.session_id, "created_at": session.created_at}


@router.get("/sessions/{session_id}")
async def get_session(session_id: str) -> dict:
    """Get session history and context."""
    session = _session_manager.get_session(session_id)
    if not session:
        raise HTTPException(404, f"Session {session_id} not found")
    return session.to_dict()


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str) -> dict:
    """Delete a conversation session."""
    deleted = _session_manager.delete_session(session_id)
    if not deleted:
        raise HTTPException(404, f"Session {session_id} not found")
    return {"deleted": True}


@router.get("/sessions")
async def list_sessions() -> dict:
    """List all active sessions."""
    sessions = _session_manager.list_sessions()
    return {"sessions": sessions, "count": len(sessions)}
