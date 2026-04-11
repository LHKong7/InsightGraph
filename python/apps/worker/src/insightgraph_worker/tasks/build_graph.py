from __future__ import annotations

import asyncio
import logging

from insightgraph_worker.app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, name="insightgraph.build_graph")
def build_graph(self, doc_ir_data: dict, report_id: str) -> dict:
    """Run extraction, resolution, graph writing, and embedding pipeline.

    Expects the serialized DocumentIR dict from the parse task.
    Returns a summary of what was written.
    """
    logger.info("Building graph for report %s", report_id)
    return asyncio.get_event_loop().run_until_complete(_build_graph_async(doc_ir_data, report_id))


async def _build_graph_async(doc_ir_data: dict, report_id: str) -> dict:
    from insightgraph_core.config import get_settings
    from insightgraph_core.ir.models import DocumentIR
    from insightgraph_extractor.pipeline import ExtractionPipeline
    from insightgraph_graph.connection import Neo4jConnection
    from insightgraph_graph.embedding_writer import EmbeddingWriter
    from insightgraph_graph.writer import GraphWriter
    from insightgraph_resolver.service import ResolverService
    from insightgraph_retriever.embeddings import EmbeddingService

    settings = get_settings()
    doc = DocumentIR.model_validate(doc_ir_data)

    # Load domain config
    from insightgraph_core.domain import load_domain_config

    domain_config = load_domain_config(settings.domain)

    # Extract
    pipeline = ExtractionPipeline(
        model=settings.llm_model,
        api_key=settings.llm_api_key,
        domain_config=domain_config,
    )
    extractions = await pipeline.extract(doc)

    # Resolve entities
    resolver = ResolverService(
        model=settings.llm_model,
        api_key=settings.llm_api_key,
    )
    extractions = await resolver.resolve(extractions)

    # Write to Neo4j
    conn = Neo4jConnection(
        uri=settings.neo4j_uri,
        user=settings.neo4j_user,
        password=settings.neo4j_password,
    )
    try:
        writer = GraphWriter(conn)
        result = await writer.write_document(doc, extractions)

        # Generate and store embeddings
        if settings.llm_api_key:
            embedding_service = EmbeddingService(
                model=settings.embedding_model,
                api_key=settings.llm_api_key,
            )
            embedding_writer = EmbeddingWriter(conn, embedding_service)
            embed_result = await embedding_writer.embed_all(report_id)
            result.update(embed_result)

        return result
    finally:
        await conn.close()
