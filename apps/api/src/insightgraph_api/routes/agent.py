from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import BaseModel

from insightgraph_agent.orchestrator import AgentResponse, Orchestrator
from insightgraph_graph.reader import GraphReader
from insightgraph_retriever.graph_retriever import GraphRetriever
from insightgraph_retriever.tools import AgentTools

router = APIRouter(prefix="/api/v1/agent", tags=["agent"])


class QuestionRequest(BaseModel):
    question: str
    report_id: str | None = None


@router.post("/query", response_model=AgentResponse)
async def ask_question(request: Request, body: QuestionRequest) -> AgentResponse:
    """Ask a question about ingested reports using the full agent pipeline."""
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

    return await orchestrator.query(body.question)
