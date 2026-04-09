# InsightGraph Architecture

## System Overview

InsightGraph transforms documents into evidence-centric knowledge graphs that AI agents can query and analyze. It uses a graph-first architecture where Neo4j graph traversal is the primary retrieval path, with vector search as a supplementary semantic layer.

```
+------------------+   +---------------------------+   +------------------+
| Ingestion Layer  |-->| KG Construction Layer     |-->| Storage Layer    |
| PDF/CSV/JSON     |   | Entity/Claim/Metric/Rel   |   | Neo4j + Vector   |
| Format detection |   | Evidence linking / Resolve |   | Redis (queue)    |
+------------------+   +---------------------------+   +------------------+
                                    |
                                    v
                        +---------------------------+
                        |     Retrieval Layer        |
                        | Graph / Vector / Hybrid    |
                        +---------------------------+
                                    |
                                    v
                        +---------------------------+
                        |     Agent Runtime          |
                        | Planner -> Retriever ->    |
                        | Analyst -> Verifier        |
                        +---------------------------+
                                    |
                        +-----------+-------------+
                        |                         |
                   REST API               MCP Server
                  (FastAPI)          (Claude Desktop)
```

## Codebase Statistics

| Metric | Value |
|--------|-------|
| Python files | 85 |
| Lines of code | ~7,600 |
| Packages | 8 core + 3 apps |
| Unit tests | 24 |
| API endpoints | 20+ |
| Agent tools | 12 |
| MCP tools | 8 |
| Graph node types | 9 |
| Graph edge types | 30+ (17 built-in + domain-specific) |

## Package Architecture

```
packages/
├── core/             # Types, config, Document IR, ontology, domain configs
├── ingestion/        # File receiving, format detection, dedup
├── parser/           # PDF/CSV/JSON -> Document IR
├── extractor/        # LLM-based entity/metric/claim/relationship extraction
├── resolver/         # Entity resolution and deduplication
├── graph/            # Neo4j connection, schema, writer, reader, embeddings
├── retriever/        # Graph/vector/hybrid retrieval, agent tools, analytics
└── agent_runtime/    # Planner/Retriever/Analyst/Verifier, sessions

apps/
├── api/              # FastAPI REST API (20+ endpoints)
├── worker/           # Celery async pipeline worker
└── mcp-server/       # MCP server for Claude Desktop/IDE integration
```

### Dependency Graph

```
core (zero heavy deps)
 ↑
ingestion, parser, extractor, resolver (depend on core)
 ↑
graph (depends on core; neo4j driver)
 ↑
retriever (depends on core + graph; litellm)
 ↑
agent_runtime (depends on core + retriever; litellm)
 ↑
api, worker, mcp-server (depend on everything)
```

## Data Flow

```
Document Input (PDF/CSV/JSON)
        |
        v
   Format Detection + Staging + Content Hashing (dedup)
        |
        v
   Document Parsing → Document IR (sections, paragraphs, blocks)
        |
        v
   LLM Extraction (concurrent):
   ├── Entity Extractor → entities with types
   ├── Metric Extractor → metric values with periods
   ├── Claim Extractor → assertions with confidence
   └── Relationship Extractor → entity-to-entity relations
        |
        v
   Entity Resolution (string rules + LLM)
        |
        v
   Graph Write (Neo4j, atomic transaction)
   ├── Document structure nodes (Report → Section → Paragraph)
   ├── Semantic nodes (Entity, Metric, Claim)
   ├── Evidence links (SUPPORTED_BY → SourceSpan)
   └── Entity relationships (typed directed edges)
        |
        v
   Embedding Generation (Paragraph + Claim vectors)
        |
        v
   Ready for Agent Queries
```

## Graph Model

### Node Types

| Category | Node | Key Properties |
|----------|------|---------------|
| Structure | Report | report_id, title, source_filename, date |
| Structure | Section | section_id, title, level, order |
| Structure | Paragraph | paragraph_id, text, page, embedding |
| Evidence | SourceSpan | span_id, text, page, start_char, end_char |
| Semantic | Entity | entity_id, name, canonical_name, entity_type |
| Semantic | Metric | metric_id, name, unit |
| Semantic | MetricValue | value_id, value, unit, period |
| Semantic | Claim | claim_id, text, claim_type, confidence, embedding |
| Temporal | TimePeriod | period_id, label, start_date, end_date |

### Edge Types

**Document structure:** HAS_SECTION, HAS_PARAGRAPH, PART_OF, HAS_SPAN

**Semantic:** MENTIONS, ASSERTS, MEASURES, HAS_VALUE, REFERS_TO_PERIOD, ABOUT

**Evidence:** SUPPORTED_BY, DERIVED_FROM, SOURCED_FROM

**Entity relationships:** Dynamic — any `[A-Z][A-Z0-9_]*` pattern accepted. Built-in: SUBSIDIARY_OF, CEO_OF, COMPETES_WITH, PARTNERS_WITH, etc. Domain-specific: CAUSES_PRICE_CHANGE, DRIVES_TRAFFIC, etc.

**Resolution:** SAME_AS

## Retrieval Architecture

### Three Retrieval Modes

1. **Graph-first (default):** Entity fulltext search → neighborhood expansion → claims/metrics/evidence
2. **Vector:** Semantic embedding search over Paragraph and Claim nodes
3. **Hybrid:** Graph-first with vector supplement, merged via Reciprocal Rank Fusion (0.6 graph / 0.4 vector)

### Agent Runtime Pipeline

```
User Question
    |
    v
Planner (LLM) → generates tool execution plan
    |
    v
Iterative Retriever → executes tools, follows entity chains (max 3 rounds)
    |
    v
Analyst (LLM) → synthesizes evidence-backed answer with citations
    |
    v
Verifier (LLM) → checks evidence support, detects contradictions
    |
    v
AgentResponse (answer + key_findings + evidence + confidence)
```

## Domain Configuration

InsightGraph supports pluggable domain configurations that customize entity types, relationship types, and extraction behavior.

| Domain | Entity Types | Relationship Types |
|--------|-------------|-------------------|
| default | ORGANIZATION, PERSON, LOCATION, PRODUCT, INDUSTRY, EVENT | SUBSIDIARY_OF, CEO_OF, COMPETES_WITH, etc. (13) |
| stock_analysis | STOCK, COMPANY, NEWS_EVENT, PRICE_MOVEMENT, SECTOR | CAUSES_PRICE_CHANGE, TRIGGERS, CORRELATES_WITH, etc. (8) |
| restaurant_analysis | RESTAURANT, DISH, INGREDIENT, CUSTOMER_SEGMENT | DRIVES_TRAFFIC, POPULAR_WITH, PAIRS_WITH, etc. (8) |

Custom domains can be defined via YAML files and loaded via `IG_DOMAIN=path/to/config.yaml`.

## Key Design Principles

1. **Evidence-centric:** Every conclusion has traceable source locations
2. **Graph-first:** Graph queries are primary, vector search supplements
3. **Tool-first:** Agents use explicit tools, not free-form Cypher
4. **Domain-extensible:** Entity/relationship types are dynamic, not hardcoded enums
5. **Async-first:** All I/O operations are async (Neo4j, LLM, embedding)
