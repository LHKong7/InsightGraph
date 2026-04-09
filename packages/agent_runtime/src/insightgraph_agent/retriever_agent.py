from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


class RetrieverAgent:
    """Executes a tool plan from the Planner and aggregates results."""

    def __init__(self, tools: Any):
        self._tools = tools

    async def execute_plan(self, tool_plan: list[dict]) -> list[dict]:
        """Execute each step in the tool plan and collect results.

        Returns a list of {tool, args, result} dicts.
        """
        results = []
        for step in tool_plan:
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
