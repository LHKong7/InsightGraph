# InsightGraph MVP Roadmap

## Phase 1: Foundation (Current)

### Input
- PDF reports

### Extraction
- Section / Paragraph structure
- Entity extraction (ORGANIZATION, PERSON, LOCATION, PRODUCT, INDUSTRY)
- Metric / MetricValue extraction
- Claim extraction (FACTUAL, OPINION, PREDICTION)
- SourceSpan evidence linking

### Graph
- Neo4j storage with ontology-driven schema
- Basic entity resolution (string rules + LLM)
- Evidence linking (Claim/MetricValue -> SourceSpan)

### Agent Tools
- `find_entities` - Search entities
- `get_claims_about` - Get claims mentioning an entity
- `get_metric_history` - Get metric values over time
- `find_evidence_for_claim` - Trace evidence
- `get_subgraph_for_question` - Retrieve relevant subgraph

### Scenarios
- Single report Q&A
- Single entity trend analysis
- Metric comparison
- Evidence tracing

---

## Phase 2: Analytics

- Trend / Comparison / Risk analysis views
- Cross-report entity merging
- Better evidence ranking and scoring
- DOCX and HTML parser support
- Analyst UI (web dashboard)
- Improved entity resolution with embeddings

---

## Phase 3: Agent-Native

- MCP server for Claude Desktop / IDE integration
- Multi-agent workflow orchestration
- Evaluation benchmark suite
- Schema evolution and migration
- Graph memory for agent sessions

---

## Phase 4: Ecosystem

- Multi-industry ontology packages
- Third-party parser/extractor plugins
- Community benchmark datasets
- InsightGraph Hub for sharing ontologies
