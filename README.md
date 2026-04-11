# InsightGraph

> Turn reports into evidence-centric knowledge graphs for AI agent analysis.

InsightGraph is an open-source system that converts PDF reports into structured knowledge graphs with explicit entities, metrics, claims, and evidence linkage. Unlike typical RAG pipelines that chunk documents and do vector search, InsightGraph builds a graph-first representation enabling traceable, verifiable answers.

## Architecture

```
+------------------+   +---------------------------+   +------------------+
| Parsing Layer    |-->| KG Construction Layer     |-->| Storage Layer    |
| PDF/DOCX parser  |   | Entity/Claim/Metric/Rel   |   | Neo4j / VectorDB |
| Layout extract   |   | Evidence linking / Resolve |   | Metadata store   |
+------------------+   +---------------------------+   +------------------+
                                    |
                                    v
                        +---------------------------+
                        |     Agent Runtime         |
                        | Planner -> Retriever ->   |
                        | Analyst -> Verifier       |
                        +---------------------------+
```

## Core Design Principles

1. **Document structure is knowledge** - Sections, tables, figures, footnotes all participate in graph construction
2. **Evidence-centric** - Every conclusion must have traceable evidence sources with page numbers
3. **Graph-first** - Graph queries and analysis are the primary path; vector search is supplementary
4. **Tool-first** - Agents use explicit tools with defined schemas, not free-form Cypher
5. **Analysis objectified** - Trends, comparisons, contradictions are explicit graph objects

## Repository Structure

```
InsightGraph/
├── python/                  # Python backend (API, worker, MCP server, all packages)
│   ├── packages/            # Core libraries (8 packages)
│   ├── apps/                # API server, Celery worker, MCP server
│   ├── tests/               # Python unit tests
│   └── pyproject.toml       # uv workspace root
├── typescript/
│   ├── sdk/                 # TypeScript SDK (insightgraph-sdk)
│   └── web/                 # Next.js frontend with graph visualization
└── docs/                    # Architecture, API reference, evaluation
```

## Quick Start

### Python Backend

```bash
cd python

# Start infrastructure
make docker-up

# Install dependencies
make install

# Run tests
make test
```

### Configuration

Set environment variables with the `IG_` prefix:

```bash
export IG_NEO4J_URI=bolt://localhost:7687
export IG_NEO4J_USER=neo4j
export IG_NEO4J_PASSWORD=insightgraph
export IG_LLM_MODEL=gpt-4o-mini
export IG_LLM_API_KEY=your-api-key
```

### Run the API

```bash
cd python
uv run uvicorn insightgraph_api.main:app --reload --host 0.0.0.0 --port 8000
```

### TypeScript SDK

```bash
npm install insightgraph-sdk
```

```typescript
import { InsightGraphClient } from "insightgraph-sdk";

const client = new InsightGraphClient({ baseUrl: "http://localhost:8000" });

// Search
const results = await client.search({ query: "revenue growth", mode: "hybrid" });

// Agent query
const answer = await client.agentQuery({ question: "What drove revenue growth?" });
console.log(answer.answer, answer.confidence);

// Entity profile
const entities = await client.searchEntities("NVIDIA");

// Session-based conversation
const session = await client.createSession();
const r1 = await client.agentQuery({ question: "Tell me about Company X", session_id: session.session_id });
const r2 = await client.agentQuery({ question: "What are its key risks?", session_id: session.session_id });
```

### Web Frontend

```bash
cd typescript/web
npm install
npm run dev   # http://localhost:3000
```

### Run the Celery Worker

```bash
uv run celery -A insightgraph_worker.app worker --loglevel=info
```

## API Endpoints

### Ingestion
- `POST /api/v1/reports/upload` - Upload a PDF report
- `POST /api/v1/reports/{report_id}/parse` - Trigger parsing
- `POST /api/v1/reports/{report_id}/build-graph` - Trigger graph construction
- `GET /api/v1/reports/{report_id}/status` - Check pipeline status

### Graph Query
- `GET /api/v1/entities/search?q=nvidia&type=ORGANIZATION` - Search entities
- `GET /api/v1/entities/{entity_id}/claims` - Get claims about an entity
- `GET /api/v1/entities/{entity_id}/metrics` - Get metrics for an entity
- `GET /api/v1/claims/{claim_id}/evidence` - Trace evidence for a claim
- `GET /api/v1/subgraph/question?q=...` - Get relevant subgraph

### Agent
- `POST /api/v1/agent/query` - Ask a question with full agent pipeline

## Project Structure

```
insightgraph/
├── apps/
│   ├── api/              # FastAPI application
│   └── worker/           # Celery async worker
├── packages/
│   ├── core/             # Types, config, Document IR, ontology
│   ├── ingestion/        # File receiving, format detection
│   ├── parser/           # PDF -> Document IR
│   ├── extractor/        # LLM-based entity/metric/claim extraction
│   ├── resolver/         # Entity resolution
│   ├── graph/            # Neo4j connection, writer, reader
│   ├── retriever/        # Graph/vector retrieval, agent tools
│   └── agent_runtime/    # Planner/Retriever/Analyst/Verifier
├── tests/
├── docs/
└── docker-compose.yml
```

## Graph Model

### Node Types

| Category | Nodes |
|----------|-------|
| Document Structure | Report, Section, Paragraph, SourceSpan |
| Semantic | Entity, Metric, MetricValue, Claim, TimePeriod |

### Key Relationships

- `Report -[HAS_SECTION]-> Section -[HAS_PARAGRAPH]-> Paragraph`
- `Paragraph -[ASSERTS]-> Claim -[ABOUT]-> Entity`
- `Entity -[HAS_VALUE]-> MetricValue -[MEASURES]-> Metric`
- `Claim -[SUPPORTED_BY]-> SourceSpan` (evidence tracing)

## Agent Tools

The agent runtime exposes five core tools:

| Tool | Description |
|------|-------------|
| `find_entities` | Search entities by name and type |
| `get_claims_about` | Get assertions about an entity |
| `get_metric_history` | Get metric values over time |
| `find_evidence_for_claim` | Trace a claim to source text |
| `get_subgraph_for_question` | Get relevant subgraph for open-ended questions |

## Tech Stack

- **Language**: Python 3.11+
- **API**: FastAPI
- **Graph DB**: Neo4j
- **Task Queue**: Celery + Redis
- **LLM**: litellm (provider-agnostic)
- **PDF Parsing**: PyMuPDF
- **Package Management**: uv with workspaces

## Documentation

- [Architecture](docs/architecture.md) - System design, data flow, package structure
- [API Reference](docs/api-reference.md) - REST API endpoints and MCP tools
- [Ontology](docs/ontology.md) - Graph model (node types, edge types, properties)
- [Evaluation](docs/evaluation.md) - Capability matrix, performance, test coverage, security
- [MVP Roadmap](docs/mvp-roadmap.md) - Phase 1-4 roadmap

## License

MIT
