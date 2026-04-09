from __future__ import annotations

from neo4j import AsyncDriver, AsyncGraphDatabase


class Neo4jConnection:
    """Manages an async Neo4j driver instance."""

    def __init__(self, uri: str, user: str, password: str) -> None:
        self._driver: AsyncDriver = AsyncGraphDatabase.driver(uri, auth=(user, password))

    async def verify_connectivity(self) -> None:
        """Verify the driver can reach the database."""
        await self._driver.verify_connectivity()

    def session(self, **kwargs):  # noqa: ANN003
        """Return a new async session (pass-through to driver)."""
        return self._driver.session(**kwargs)

    async def close(self) -> None:
        """Close the underlying driver and release all resources."""
        await self._driver.close()
