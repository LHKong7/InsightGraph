from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


class RetrieverAgent:
    """Iterative retriever that follows graph connections across rounds.

    Unlike a simple for-loop executor, this agent:
    1. Executes the initial plan
    2. Extracts entities from results
    3. Generates follow-up queries to explore entity neighborhoods
    4. Stops when no new information is found or max_iterations reached
    """

    def __init__(self, tools: Any, max_iterations: int = 3):
        self._tools = tools
        self._max_iterations = max_iterations

    async def execute_plan(self, tool_plan: list[dict]) -> list[dict]:
        """Execute a tool plan with iterative graph exploration.

        Returns a list of {tool, args, result, error} dicts.
        """
        all_results: list[dict] = []
        discovered_entities: set[str] = set()

        # Round 1: Execute the original plan
        round_results = await self._execute_steps(tool_plan)
        all_results.extend(round_results)

        # Extract entities from results
        new_entities = self._extract_entities(round_results)
        discovered_entities.update(new_entities)

        # Round 2+: Follow graph connections
        for iteration in range(self._max_iterations - 1):
            follow_ups = self._generate_follow_ups(round_results, discovered_entities)
            if not follow_ups:
                logger.debug("No follow-up queries at iteration %d", iteration + 1)
                break

            logger.info(
                "Iteration %d: %d follow-up queries",
                iteration + 1,
                len(follow_ups),
            )
            round_results = await self._execute_steps(follow_ups)
            all_results.extend(round_results)

            new = self._extract_entities(round_results) - discovered_entities
            if not new:
                logger.debug("No new entities at iteration %d", iteration + 1)
                break
            discovered_entities.update(new)

        return all_results

    async def _execute_steps(self, steps: list[dict]) -> list[dict]:
        """Execute a list of tool steps."""
        results = []
        for step in steps:
            tool_name = step.get("tool", "")
            args = step.get("args", {})
            try:
                result = await self._tools.execute(tool_name, args)
                results.append(
                    {
                        "tool": tool_name,
                        "args": args,
                        "result": result,
                        "error": None,
                    }
                )
            except Exception as e:
                logger.warning("Tool %s failed: %s", tool_name, e, exc_info=True)
                results.append(
                    {
                        "tool": tool_name,
                        "args": args,
                        "result": None,
                        "error": str(e),
                    }
                )
        return results

    @staticmethod
    def _extract_entities(results: list[dict]) -> set[str]:
        """Extract entity names from tool execution results."""
        entities: set[str] = set()
        for r in results:
            result = r.get("result")
            if result is None:
                continue

            if isinstance(result, list):
                for item in result:
                    if isinstance(item, dict):
                        for key in ("name", "canonical_name", "entity_name", "mentioned_entity"):
                            val = item.get(key)
                            if val:
                                entities.add(val)
                        # Also check nested entity dicts
                        entity = item.get("entity")
                        if isinstance(entity, dict):
                            for key in ("name", "canonical_name"):
                                val = entity.get(key)
                                if val:
                                    entities.add(val)

            elif isinstance(result, dict):
                for key in ("name", "canonical_name"):
                    val = result.get(key)
                    if val:
                        entities.add(val)
                # Check nodes in subgraph results
                for node in result.get("nodes", []):
                    if isinstance(node, dict):
                        props = node.get("props", node)
                        for key in ("name", "canonical_name"):
                            val = props.get(key)
                            if val:
                                entities.add(val)

        return entities

    @staticmethod
    def _generate_follow_ups(
        results: list[dict],
        known_entities: set[str],
    ) -> list[dict]:
        """Generate follow-up tool calls based on discovered entities.

        Explores entity neighborhoods by querying for:
        - Claims about newly discovered entities
        - Relationships of entities
        - Evidence for high-confidence claims
        """
        follow_ups: list[dict] = []
        seen_queries: set[str] = set()

        for r in results:
            result = r.get("result")
            if result is None:
                continue

            # If we found entities, get claims about them
            entities = RetrieverAgent._extract_entities([r])
            for ename in entities:
                query_key = f"claims:{ename}"
                if query_key not in seen_queries and r.get("tool") != "get_claims_about":
                    follow_ups.append(
                        {
                            "tool": "get_claims_about",
                            "args": {"entity_name": ename},
                        }
                    )
                    seen_queries.add(query_key)

                # Also explore entity relationships
                rel_key = f"relationships:{ename}"
                if rel_key not in seen_queries:
                    follow_ups.append(
                        {
                            "tool": "find_related_entities",
                            "args": {"entity_name": ename, "depth": 1},
                        }
                    )
                    seen_queries.add(rel_key)

            # If we found claims, trace evidence for high-confidence ones
            if isinstance(result, list):
                for item in result:
                    if isinstance(item, dict):
                        claim_id = item.get("claim_id")
                        confidence = item.get("confidence", 0)
                        if claim_id and confidence and confidence > 0.7:
                            ev_key = f"evidence:{claim_id}"
                            if ev_key not in seen_queries:
                                follow_ups.append(
                                    {
                                        "tool": "find_evidence_for_claim",
                                        "args": {"claim_id": claim_id},
                                    }
                                )
                                seen_queries.add(ev_key)

        # Limit follow-ups per round
        return follow_ups[:10]
