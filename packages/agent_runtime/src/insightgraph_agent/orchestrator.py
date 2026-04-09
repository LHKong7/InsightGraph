from __future__ import annotations

import logging
from typing import Any

from pydantic import BaseModel, Field

from insightgraph_agent.analyst import Analyst
from insightgraph_agent.planner import Planner
from insightgraph_agent.retriever_agent import RetrieverAgent
from insightgraph_agent.verifier import Verifier

logger = logging.getLogger(__name__)


class AgentResponse(BaseModel):
    """The final response from the agent pipeline."""

    answer: str
    key_findings: list[str] = Field(default_factory=list)
    evidence: list[dict] = Field(default_factory=list)
    confidence: float = 0.0
    verified: bool = False
    question_type: str = ""
    steps_executed: int = 0


class Orchestrator:
    """Runs the Planner -> Retriever -> Analyst -> Verifier pipeline.

    Returns an evidence-backed answer with source citations.
    """

    def __init__(
        self,
        tools: Any,
        model: str = "gpt-4o-mini",
        api_key: str = "",
    ):
        self._planner = Planner(model=model, api_key=api_key)
        self._retriever = RetrieverAgent(tools)
        self._analyst = Analyst(model=model, api_key=api_key)
        self._verifier = Verifier(model=model, api_key=api_key)

    async def query(self, question: str) -> AgentResponse:
        """Process a question through the full agent pipeline."""
        # Step 1: Plan
        logger.info("Planning for question: %s", question[:100])
        plan = await self._planner.plan(question)
        question_type = plan.get("question_type", "general")
        tool_plan = plan.get("tool_plan", [])

        # Step 2: Retrieve
        logger.info("Executing %d tool steps", len(tool_plan))
        retrieval_results = await self._retriever.execute_plan(tool_plan)

        # Step 3: Analyze
        logger.info("Analyzing results")
        analysis = await self._analyst.analyze(question, retrieval_results)

        # Step 4: Verify
        logger.info("Verifying analysis")
        verification = await self._verifier.verify(analysis, retrieval_results)

        # Build response
        confidence = verification.get("adjusted_confidence", analysis.get("confidence", 0.0))

        return AgentResponse(
            answer=analysis.get("answer", "No answer available."),
            key_findings=analysis.get("key_findings", []),
            evidence=analysis.get("evidence_used", []),
            confidence=confidence,
            verified=verification.get("verified", False),
            question_type=question_type,
            steps_executed=len(tool_plan),
        )
