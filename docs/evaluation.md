# InsightGraph System Evaluation

## 1. Capability Matrix

### What the System Can Do

| Capability | Status | Details |
|-----------|--------|---------|
| PDF report ingestion | Done | PyMuPDF parser with heading detection, section segmentation, table extraction |
| CSV data ingestion | Done | Row-per-block parsing with column metadata |
| JSON data ingestion | Done | Array-of-objects and nested-object support |
| Entity extraction | Done | LLM-based, domain-configurable entity types |
| Metric extraction | Done | Numeric values with units, periods, entity association |
| Claim extraction | Done | Assertions with types (factual/opinion/prediction/causal) and confidence |
| Relationship extraction | Done | Entity-to-entity with dynamic types (CEO_OF, CAUSES_PRICE_CHANGE, etc.) |
| Entity resolution | Done | String normalization + LLM-powered deduplication |
| Evidence tracing | Done | Claim/Metric → SourceSpan with page numbers and character offsets |
| Neo4j graph storage | Done | Ontology-driven schema with constraints, fulltext indexes, vector indexes |
| Vector embeddings | Done | 1536-dim embeddings on Paragraph and Claim nodes |
| Graph-first retrieval | Done | Entity fulltext → neighborhood expansion → claims/metrics/evidence |
| Vector semantic search | Done | Cosine similarity search over paragraph/claim embeddings |
| Hybrid retrieval | Done | Graph-first + vector supplement with RRF fusion (0.6/0.4 weights) |
| Agent pipeline | Done | Planner → Iterative Retriever → Analyst → Verifier |
| Cross-report analysis | Done | Entity comparison, metric trends, contradiction detection, timelines |
| Graph analytics | Done | Degree centrality, co-occurrence, report coverage |
| MCP server | Done | 8 tools for Claude Desktop/IDE integration |
| Conversation sessions | Done | Multi-turn context with session management |
| Domain extensibility | Done | Stock, restaurant, custom YAML domains |
| Duplicate detection | Done | SHA-256 content hashing |
| REST API | Done | 20+ endpoints for ingestion, search, query, agent |
| Async pipeline | Done | Celery + Redis for background processing |

### What the System Cannot Do (Yet)

| Gap | Impact | Difficulty |
|-----|--------|-----------|
| DOCX/HTML parsing | Only PDF/CSV/JSON supported | Easy — add parser implementations |
| OCR for scanned PDFs | Can't process image-based PDFs | Medium — integrate Tesseract/Docling |
| Authentication/authorization | All endpoints are open | Medium — add JWT/OAuth |
| Persistent sessions | Sessions lost on restart (in-memory) | Easy — use Redis backend |
| Graph diff/versioning | Can't track what changed between report versions | Medium |
| Advanced graph algorithms | No PageRank, Louvain, betweenness centrality | Medium — integrate Neo4j GDS |
| Streaming agent responses | Agent returns all-at-once | Medium — add SSE streaming |
| Multi-language support | Prompts are English-only | Easy — translate prompts |
| UI dashboard | CLI/API only | Large — build web frontend |

---

## 2. Architecture Evaluation

### Strengths

1. **Evidence-centric design**: Every claim and metric traces back to exact source text with page numbers. This is the system's strongest differentiator vs typical RAG.

2. **Graph-first retrieval**: Entity relationships and graph structure drive retrieval, not just semantic similarity. The iterative retriever follows entity chains across multiple rounds.

3. **Domain extensibility**: Entity types, relationship types, and extraction instructions are configurable via YAML. No code changes needed for new domains.

4. **Clean package architecture**: 8 packages with clear dependency boundaries. Core has no heavy dependencies. Each package is independently testable.

5. **Ontology-driven schema**: Node types, edge types, constraints, and indexes all defined in YAML and auto-created in Neo4j.

6. **Async-first**: All I/O operations (Neo4j, LLM, embeddings) are async. Concurrent extraction via asyncio.gather.

### Weaknesses

1. **LLM dependency**: Extraction quality depends entirely on the LLM. No fallback to rule-based extraction. If the LLM API is down, the system cannot extract anything.

2. **Single-document entity resolution**: Entity resolver works within one document. Cross-document resolution exists via SAME_AS edges but is not automatically triggered during ingestion.

3. **No evaluation framework**: No automated way to measure extraction quality (precision/recall) or answer quality (groundedness/coverage).

4. **Limited error recovery**: If extraction fails halfway, the graph may be in a partial state. No transaction rollback at the pipeline level.

5. **In-memory state**: IngestionService tasks and SessionManager sessions are in-memory. Lost on restart.

6. **No caching**: Expensive queries (entity profiles, metric histories) are re-executed every time.

---

## 3. Performance Characteristics

### Ingestion Pipeline

| Stage | Bottleneck | Estimated Speed |
|-------|-----------|----------------|
| PDF Parsing | CPU (PyMuPDF) | ~1-2 sec per 100 pages |
| Entity Extraction | LLM API latency | ~2-5 sec per batch of 5 blocks |
| Metric Extraction | LLM API latency | ~2-5 sec per batch |
| Claim Extraction | LLM API latency | ~2-5 sec per batch |
| Relationship Extraction | LLM API latency | ~2-5 sec per batch |
| Entity Resolution | LLM API latency | ~1-3 sec |
| Graph Write | Neo4j transaction | ~0.5-2 sec |
| Embedding Generation | Embedding API | ~1-3 sec per 100 paragraphs |

**Total estimated time for a 20-page report**: 30-120 seconds (dominated by LLM calls)

### Query Performance

| Query Type | Mechanism | Estimated Latency |
|-----------|-----------|-------------------|
| Entity search | Neo4j fulltext index | <50ms |
| Claims about entity | Neo4j traversal | <100ms |
| Metric history | Neo4j traversal | <100ms |
| Evidence for claim | Neo4j traversal | <50ms |
| Vector search | Neo4j vector index | <200ms |
| Hybrid search | Graph + vector + RRF | <500ms |
| Agent query | Multiple LLM calls | 5-15 seconds |

---

## 4. Comparison with Alternatives

### vs Traditional RAG (LangChain + Vector DB)

| Aspect | InsightGraph | Traditional RAG |
|--------|-------------|----------------|
| Retrieval | Graph-first + vector supplement | Vector-only |
| Evidence tracing | Exact page/char offsets | Chunk-level (lossy) |
| Entity relationships | Explicit typed edges | None |
| Cross-report analysis | Built-in (compare, trends, contradictions) | Not available |
| Structured data | Entities, metrics, claims as separate types | Everything is chunks |
| Setup complexity | Higher (Neo4j + Redis + LLM) | Lower (vector DB + LLM) |
| Extraction cost | Higher (multiple LLM calls) | Lower (just embedding) |

### vs Knowledge Graph Systems (LightRAG, GraphRAG)

| Aspect | InsightGraph | LightRAG/GraphRAG |
|--------|-------------|-------------------|
| Evidence tracing | Full source provenance | Limited |
| Domain extensibility | YAML-configurable domains | Fixed ontology |
| Agent integration | MCP server + REST API + 12 tools | Limited API |
| Metric extraction | Dedicated metric/MetricValue nodes | Mixed with entities |
| Cross-report | Built-in comparison and contradiction detection | Not available |
| Relationship types | Dynamic, domain-specific | Fixed or auto-generated |

---

## 5. Use Case Evaluation

### Use Case 1: Equity Research Report Analysis

**Scenario**: Analyst uploads quarterly earnings reports and asks questions.

**Supported operations:**
- Upload PDF report
- Extract companies, financial metrics, analyst opinions
- Build entity relationship graph (SUBSIDIARY_OF, COMPETES_WITH)
- Query: "What drove revenue growth?" → graph traversal + evidence citations
- Compare metrics across quarters (cross-report)
- Detect contradictions between analyst opinions

**Assessment**: Fully supported. Core use case the system was designed for.

### Use Case 2: Stock News + Price Analysis

**Scenario**: User has stock news CSV and wants causal relationships.

**Supported operations:**
- Set `IG_DOMAIN=stock_analysis`
- Upload CSV with stock news + price data
- Extract STOCK, NEWS_EVENT, PRICE_MOVEMENT entities
- Build causal graph (CAUSES_PRICE_CHANGE, TRIGGERS, CORRELATES_WITH)
- Agent queries: "What caused AAPL to rise?"

**Assessment**: Supported with stock_analysis domain config. CSV parser handles structured data. Domain prompts guide LLM to extract stock-specific relationships.

### Use Case 3: Restaurant Report Analysis

**Scenario**: Restaurant chain analyzes dish performance vs customer traffic.

**Supported operations:**
- Set `IG_DOMAIN=restaurant_analysis`
- Upload restaurant reports (PDF or CSV)
- Extract DISH, CUSTOMER_SEGMENT, RESTAURANT entities
- Build traffic graph (DRIVES_TRAFFIC, POPULAR_WITH, PAIRS_WITH)
- Query: "Which dishes drive weekend traffic?"

**Assessment**: Supported with restaurant_analysis domain config.

### Use Case 4: Multi-Report Comparative Analysis

**Scenario**: Compare an entity across multiple reports over time.

**Supported operations:**
- Ingest multiple reports mentioning the same entity
- `compare_entity_across_reports("Company X")` → per-report claims + metrics
- `find_metric_trend("Company X", "Revenue")` → trend detection
- `find_contradictions("Company X")` → conflicting claims
- `entity_timeline("Company X")` → chronological view

**Assessment**: Supported via cross-report tools. Entity resolution links same entities across reports.

---

## 6. Testing Coverage

### Current Test Coverage

| Area | Tests | Type |
|------|-------|------|
| Document IR models | 8 tests | Unit — serialization, iteration, nesting |
| Ontology loading | 8 tests | Unit — YAML parsing, node/edge types, constraints |
| Configuration | 3 tests | Unit — defaults, env vars |
| Extraction models | 5 tests | Unit — entity, metric, claim, resolved entity, serialization |
| **Total** | **24 tests** | All passing |

### Missing Test Coverage

| Area | What's Missing |
|------|---------------|
| PDF parser | No test with real PDF fixtures |
| CSV/JSON parser | No parser tests |
| Entity extraction | No mocked LLM response tests |
| Graph writer | No Neo4j integration tests |
| Graph reader | No query tests |
| Hybrid retriever | No RRF scoring tests |
| Agent pipeline | No end-to-end agent tests |
| MCP server | No tool invocation tests |
| Cross-report | No comparison/contradiction tests |
| API endpoints | No HTTP request/response tests |

### Recommended Test Additions

1. **Parser tests**: Parse sample PDF/CSV/JSON fixtures, assert DocumentIR structure
2. **Extraction tests**: Mock litellm responses, verify entity/metric/claim parsing
3. **Graph integration tests**: Require Neo4j Docker, test write→read roundtrip
4. **Retriever tests**: Mock GraphReader/VectorRetriever, test hybrid fusion
5. **API tests**: Use httpx AsyncClient with test app
6. **Domain config tests**: Load stock/restaurant domains, verify entity type lists

---

## 7. Security Considerations

| Risk | Status | Mitigation |
|------|--------|-----------|
| Cypher injection | Mitigated | Parameterized queries throughout; relationship types validated via regex |
| File upload abuse | Partial | Max file size configurable; no content scanning |
| LLM prompt injection | Not mitigated | Document content passed to LLM prompts without sanitization |
| API authentication | Not implemented | All endpoints open |
| Data at rest | Not encrypted | Neo4j community edition default settings |

---

## 8. Deployment Readiness

| Criterion | Status | Notes |
|----------|--------|-------|
| Docker Compose | Ready | Neo4j + Redis services defined |
| Environment config | Ready | All settings via IG_ env vars |
| Health check endpoint | Ready | /health with Neo4j connectivity check |
| Async task queue | Ready | Celery + Redis |
| Graceful shutdown | Ready | FastAPI lifespan closes Neo4j connection |
| Logging | Basic | Python logging; no structured log format |
| Monitoring | Not ready | No Prometheus metrics, no OpenTelemetry tracing |
| Rate limiting | Not ready | No request throttling |
| Horizontal scaling | Not ready | In-memory state prevents multi-instance |

---

## 9. Recommendations

### Short-term (1-2 weeks)
1. Add parser and extraction tests with mocked LLM responses
2. Add Neo4j integration tests with Docker
3. Replace in-memory state (IngestionService, SessionManager) with Redis
4. Add structured logging (structlog)

### Medium-term (1-2 months)
1. Add DOCX/HTML parsers
2. Implement authentication (JWT)
3. Add OpenTelemetry tracing across pipeline stages
4. Build evaluation framework for extraction quality
5. Add Prometheus metrics endpoint

### Long-term (3+ months)
1. Web UI for graph exploration and agent chat
2. Multi-agent orchestration (specialized analyst agents)
3. Neo4j GDS integration for advanced graph algorithms
4. Schema evolution and migration tooling
5. Plugin system for third-party parsers and extractors
