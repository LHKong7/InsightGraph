from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime
from uuid import uuid4

logger = logging.getLogger(__name__)


@dataclass
class SessionTurn:
    """A single question-answer turn in a session."""

    question: str
    answer: str
    key_findings: list[str] = field(default_factory=list)
    entities_found: list[str] = field(default_factory=list)
    timestamp: str = field(default_factory=lambda: datetime.utcnow().isoformat())


@dataclass
class Session:
    """Maintains conversation context across multiple agent queries."""

    session_id: str = field(default_factory=lambda: uuid4().hex)
    turns: list[SessionTurn] = field(default_factory=list)
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())

    def add_turn(
        self,
        question: str,
        answer: str,
        key_findings: list[str] | None = None,
        entities_found: list[str] | None = None,
    ) -> None:
        """Record a question-answer turn."""
        self.turns.append(
            SessionTurn(
                question=question,
                answer=answer,
                key_findings=key_findings or [],
                entities_found=entities_found or [],
            )
        )

    def get_context_summary(self, max_turns: int = 5) -> str:
        """Generate a context summary for injecting into the planner prompt.

        Summarizes recent turns so the agent knows what has already been discussed.
        """
        if not self.turns:
            return ""

        recent = self.turns[-max_turns:]
        parts = ["Previous conversation context:"]
        for i, turn in enumerate(recent, 1):
            parts.append(f"\nQ{i}: {turn.question}")
            if turn.key_findings:
                parts.append(f"Key findings: {', '.join(turn.key_findings[:3])}")
            if turn.entities_found:
                parts.append(f"Entities discussed: {', '.join(turn.entities_found[:5])}")

        all_entities = set()
        for turn in self.turns:
            all_entities.update(turn.entities_found)
        if all_entities:
            parts.append(f"\nAll entities discussed so far: {', '.join(sorted(all_entities))}")

        return "\n".join(parts)

    def to_dict(self) -> dict:
        """Serialize session to dict."""
        return {
            "session_id": self.session_id,
            "created_at": self.created_at,
            "turn_count": len(self.turns),
            "turns": [
                {
                    "question": t.question,
                    "answer": t.answer[:200] + "..." if len(t.answer) > 200 else t.answer,
                    "key_findings": t.key_findings,
                    "entities_found": t.entities_found,
                    "timestamp": t.timestamp,
                }
                for t in self.turns
            ],
        }


class SessionManager:
    """Manages conversation sessions. In-memory for MVP."""

    def __init__(self) -> None:
        self._sessions: dict[str, Session] = {}

    def create_session(self) -> Session:
        session = Session()
        self._sessions[session.session_id] = session
        logger.info("Created session %s", session.session_id)
        return session

    def get_session(self, session_id: str) -> Session | None:
        return self._sessions.get(session_id)

    def delete_session(self, session_id: str) -> bool:
        if session_id in self._sessions:
            del self._sessions[session_id]
            logger.info("Deleted session %s", session_id)
            return True
        return False

    def list_sessions(self) -> list[dict]:
        return [s.to_dict() for s in self._sessions.values()]
