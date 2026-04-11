# InsightGraph

> Turn reports into evidence-centric knowledge graphs for AI agent analysis.

InsightGraph is an open-source system that converts PDF reports into structured knowledge graphs with explicit entities, metrics, claims, and evidence linkage. Unlike typical RAG pipelines that chunk documents and do vector search, InsightGraph builds a graph-first representation enabling traceable, verifiable answers.

## Architecture

```
+------------------+   +---------------------------+   +------------------+
| Parsing Layer    |-->| KG Construction Layer     |-->| Storage Layer    |
| PDF/CSV/JSON     |   | Entity/Claim/Metric/Rel   |   | Neo4j            |
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
3. **Graph-first** - Graph queries and analysis are the primary retrieval path
4. **Tool-first** - Agents use explicit tools with defined schemas, not free-form Cypher
5. **Analysis objectified** - Trends, comparisons, contradictions are explicit graph objects

## Repository Structure

```
InsightGraph/
├── packages/                    # Core libraries (7 packages)
│   ├── core/                    # Types, config, Document IR, ontology, LLM wrapper
│   ├── graph/                   # Neo4j connection, writer, reader, schema
│   ├── extractor/               # LLM-based entity/metric/claim/relationship extraction
│   ├── resolver/                # Entity resolution (rule-based + LLM)
│   ├── parser/                  # PDF/CSV/JSON -> Document IR
│   ├── retriever/               # Graph/hybrid retrieval, analytics, agent tools
│   └── agent-runtime/           # Planner -> Retriever -> Analyst -> Verifier pipeline
├── apps/                        # Applications
│   ├── api/                     # Hono API server (port 8000)
│   ├── worker/                  # BullMQ background worker
│   └── mcp-server/              # MCP tool server for Claude integration
├── sdk/                         # TypeScript client SDK
├── web/                         # Next.js frontend with graph visualization
├── electron-integration/        # Electron desktop app bridge
├── scripts/                     # Shell scripts to start services
├── docker-compose.yml           # Neo4j + Redis
├── .env.example                 # Environment variable template
└── docs/                        # Architecture, API reference, evaluation
```

## Quick Start

### Prerequisites

- Node.js 22+
- pnpm (`npm install -g pnpm`)
- Docker (for Neo4j + Redis)

### Start Infrastructure

```bash
./scripts/start-infra.sh
```

This starts Neo4j and Redis via Docker Compose and waits until they are ready.

### Install & Build

```bash
./scripts/build.sh
```

### Configuration

Copy the example and fill in your values:

```bash
cp .env.example .env
```

| Variable | Default | Description |
|----------|---------|-------------|
| `IG_NEO4J_URI` | `bolt://localhost:7687` | Neo4j connection URI |
| `IG_NEO4J_USER` | `neo4j` | Neo4j username |
| `IG_NEO4J_PASSWORD` | `insightgraph` | Neo4j password |
| `IG_LLM_MODEL` | `gpt-4o-mini` | LLM model name |
| `IG_LLM_API_KEY` | *(empty)* | API key for LLM provider |
| `IG_LLM_BASE_URL` | *(empty)* | Custom LLM API base URL (OpenAI-compatible) |
| `IG_REDIS_URL` | `redis://localhost:6379` | Redis connection URL |
| `IG_UPLOAD_DIR` | `/tmp/insightgraph/uploads` | File upload staging directory |
| `IG_DOMAIN` | `default` | Domain config (`default`, `stock_analysis`, `restaurant_analysis`, or YAML path) |

### Start All Services

```bash
./scripts/start-all.sh
```

This starts the API server, background worker, and web frontend with hot reload. All logs stream to the terminal. Press Ctrl+C to stop everything.

### Start Services Individually

```bash
# API server (http://localhost:8000) with hot reload
./scripts/start-api.sh

# Background worker with hot reload
./scripts/start-worker.sh

# Web frontend (http://localhost:3000) with HMR
./scripts/start-web.sh

# MCP server (stdio)
./scripts/start-mcp.sh
```

### TypeScript SDK

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

## API Endpoints

### Ingestion
- `POST /api/v1/reports/upload` - Upload a PDF/CSV/JSON report
- `POST /api/v1/reports/{report_id}/parse` - Trigger parsing
- `POST /api/v1/reports/{report_id}/build-graph` - Trigger graph construction
- `GET /api/v1/reports/{report_id}/status` - Check pipeline status

### Graph Query
- `GET /api/v1/entities/search?name=nvidia&entity_type=ORGANIZATION` - Search entities
- `GET /api/v1/entities/{entity_id}` - Get entity by ID
- `GET /api/v1/entities/{entity_id}/claims` - Get claims about an entity
- `GET /api/v1/entities/{entity_id}/metrics` - Get metrics for an entity
- `GET /api/v1/claims/{claim_id}/evidence` - Trace evidence for a claim
- `GET /api/v1/subgraph/question?node_id=...` - Get relevant subgraph
- `GET /api/v1/reports` - List all reports
- `GET /api/v1/reports/{report_id}` - Get report details

### Search & Retrieval
- `POST /api/v1/search` - Unified search (hybrid/graph modes)
- `POST /api/v1/retrieve` - Structured retrieval returning paragraphs, claims, entities, metrics

### Agent
- `POST /api/v1/agent/query` - Ask a question with full agent pipeline
- `POST /api/v1/sessions` - Create a conversation session
- `GET /api/v1/sessions/{session_id}` - Get session history
- `DELETE /api/v1/sessions/{session_id}` - Delete a session
- `GET /api/v1/sessions` - List all sessions

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
- `Entity -[SOURCED_FROM]-> Report` (provenance)

## Agent Tools

The agent runtime exposes 12 tools for graph exploration:

| Tool | Description |
|------|-------------|
| `find_entities` | Search entities by name and type |
| `get_entity_profile` | Comprehensive profile (claims + metrics + relationships) |
| `get_claims_about` | Get assertions about an entity |
| `get_metric_history` | Get metric values over time |
| `find_evidence_for_claim` | Trace a claim to source text |
| `get_subgraph_for_question` | Get relevant subgraph |
| `find_related_entities` | Find entities connected via relationships |
| `find_path_between_entities` | Shortest path between two entities |
| `compare_entity_across_reports` | Compare entity data across reports |
| `find_metric_trend` | Detect metric trend (increasing/decreasing/stable) |
| `find_contradictions` | Find contradicting claims about an entity |
| `entity_timeline` | Chronological timeline of claims and metrics |

## Tech Stack

| Component | Technology |
|-----------|------------|
| Language | TypeScript (Node.js 22+) |
| API Server | Hono |
| Graph Database | Neo4j |
| Task Queue | BullMQ + Redis |
| LLM Client | OpenAI SDK (compatible with any OpenAI-compatible API via `IG_LLM_BASE_URL`) |
| PDF Parsing | unpdf (pdf.js) |
| Frontend | Next.js 16 + React 19 + Tailwind CSS 4 |
| MCP Server | @modelcontextprotocol/sdk |
| Package Manager | pnpm workspaces |
| Testing | Vitest |

## Documentation

- [Architecture](docs/architecture.md) - System design, data flow, package structure
- [API Reference](docs/api-reference.md) - REST API endpoints and MCP tools
- [Ontology](docs/ontology.md) - Graph model (node types, edge types, properties)
- [Evaluation](docs/evaluation.md) - Capability matrix, performance, test coverage, security

## License

MIT
