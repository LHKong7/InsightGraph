from __future__ import annotations

import asyncio
import logging

import litellm

logger = logging.getLogger(__name__)

EMBEDDING_DIM = 1536  # text-embedding-3-small


class EmbeddingService:
    """Shared embedding service wrapping litellm for batch and single-text embedding."""

    def __init__(
        self,
        model: str = "text-embedding-3-small",
        api_key: str = "",
        max_concurrency: int = 5,
    ):
        self.model = model
        self.api_key = api_key
        self._semaphore = asyncio.Semaphore(max_concurrency)

    async def embed_text(self, text: str) -> list[float]:
        """Generate embedding for a single text string."""
        result = await self.embed_batch([text], batch_size=1)
        return result[0]

    async def embed_batch(
        self,
        texts: list[str],
        batch_size: int = 100,
    ) -> list[list[float]]:
        """Generate embeddings for a list of texts with batching.

        Processes texts in chunks of batch_size to respect API limits.
        Returns embeddings in the same order as input texts.
        """
        if not texts:
            return []

        all_embeddings: list[list[float]] = [[] for _ in texts]
        batches = [texts[i : i + batch_size] for i in range(0, len(texts), batch_size)]

        tasks = []
        for batch_idx, batch in enumerate(batches):
            tasks.append(self._embed_batch_chunk(batch, batch_idx, batch_size, all_embeddings))

        await asyncio.gather(*tasks)
        return all_embeddings

    async def _embed_batch_chunk(
        self,
        batch: list[str],
        batch_idx: int,
        batch_size: int,
        output: list[list[float]],
    ) -> None:
        """Embed a single batch chunk with concurrency control."""
        async with self._semaphore:
            try:
                kwargs: dict = {
                    "model": self.model,
                    "input": batch,
                }
                if self.api_key:
                    kwargs["api_key"] = self.api_key

                response = await litellm.aembedding(**kwargs)
                for i, item in enumerate(response.data):
                    global_idx = batch_idx * batch_size + i
                    output[global_idx] = item["embedding"]
            except Exception:
                logger.warning(
                    "Embedding batch %d failed, filling with empty vectors",
                    batch_idx,
                    exc_info=True,
                )
                for i in range(len(batch)):
                    global_idx = batch_idx * batch_size + i
                    output[global_idx] = [0.0] * EMBEDDING_DIM
