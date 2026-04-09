# InsightGraph API Reference

## Base URL

```
http://localhost:8000
```

## Authentication

Not implemented in MVP. All endpoints are open.

## Configuration

All settings via environment variables with `IG_` prefix:

```bash
IG_NEO4J_URI=bolt://localhost:7687
IG_NEO4J_USER=neo4j
IG_NEO4J_PASSWORD=insightgraph
IG_LLM_MODEL=gpt-4o-mini
IG_LLM_API_KEY=your-key
IG_EMBEDDING_MODEL=text-embedding-3-small
IG_DOMAIN=default  # or stock_analysis, restaurant_analysis, path/to/config.yaml
```

---

## Health

### GET /health

Check service health including Neo4j connectivity.

**Response:**
```json
{
  "status": "healthy",
  "neo4j": "connected"
}
```

---

## Ingestion

### POST /api/v1/reports/upload

Upload a document for processing. Supports PDF, CSV, JSON, DOCX, HTML, MD, TXT.

**Request:** `multipart/form-data` with `file` field

**Response:**
```json
{
  "task_id": "abc123",
  "report_id": "def456",
  "status": "pending",
  "source_type": "pdf"
}
```

**Notes:**
- Duplicate files (same SHA-256 hash) return the existing report_id
- Processing dispatched to Celery worker if available

### POST /api/v1/reports/{report_id}/parse

Trigger parsing of an uploaded report.

### POST /api/v1/reports/{report_id}/build-graph

Trigger KG construction (extraction + resolution + graph write + embeddings).

### GET /api/v1/reports/{report_id}/status

Check pipeline status.

**Response:**
```json
{
  "report_id": "def456",
  "task_id": "abc123",
  "status": "completed",
  "error": null
}
```

Status values: `pending`, `parsing`, `extracting`, `resolving`, `writing`, `completed`, `failed`

---

## Search & Retrieval

### POST /api/v1/search

Unified search supporting three modes.

**Request:**
```json
{
  "query": "revenue growth drivers",
  "top_k": 10,
  "mode": "hybrid",
  "report_id": null
}
```

- `mode`: `"hybrid"` (default), `"vector"`, `"graph"`

**Response:**
```json
{
  "results": [
    {
      "text": "Revenue grew 25% YoY...",
      "score": 0.89,
      "result_type": "paragraph",
      "source": "both",
      "rrf_score": 0.012,
      "page": 3,
      "section_title": "Financial Highlights",
      "report_title": "Q3 2024 Report"
    }
  ],
  "total": 10
}
```

### POST /api/v1/retrieve

Structured RAG retrieval returning categorized results.

**Request:**
```json
{
  "question": "What drove revenue growth?",
  "top_k": 10,
  "include_evidence": true
}
```

**Response:**
```json
{
  "paragraphs": [...],
  "claims": [...],
  "entities": [...],
  "metrics": [...],
  "sources": [...]
}
```

### POST /api/v1/reports/{report_id}/embed

Backfill embeddings for an existing report.

**Response:**
```json
{
  "paragraphs_embedded": 42,
  "claims_embedded": 15
}
```

---

## Graph Query

### GET /api/v1/entities/search

Search entities by name and type.

**Parameters:** `q` (string), `type` (string, optional), `limit` (int, default 50)

### GET /api/v1/entities/{entity_id}

Get a specific entity by ID.

### GET /api/v1/entities/{entity_id}/claims

Get all claims about an entity.

### GET /api/v1/entities/{entity_id}/metrics

Get metric values for an entity.

**Parameters:** `metric_name` (string, optional)

### GET /api/v1/claims/{claim_id}/evidence

Get source evidence for a claim. Returns SourceSpans with page numbers and character offsets.

### GET /api/v1/subgraph/question

Get a relevant subgraph for a question.

**Parameters:** `q` (string)

### GET /api/v1/reports

List all ingested reports.

### GET /api/v1/reports/{report_id}

Get a specific report.

---

## Agent

### POST /api/v1/agent/query

Run a question through the full agent pipeline.

**Request:**
```json
{
  "question": "What is the relationship between Company X and Company Y?",
  "session_id": "optional-session-id"
}
```

**Response:**
```json
{
  "answer": "Company X is a subsidiary of Company Y, acquired in 2023...",
  "key_findings": [
    "Company X was acquired by Company Y in Q2 2023",
    "Revenue contribution increased 15% post-acquisition"
  ],
  "evidence": [
    {"text": "source quote...", "page": 5, "claim_id": "..."}
  ],
  "confidence": 0.85,
  "verified": true,
  "question_type": "relationship",
  "steps_executed": 4
}
```

### POST /api/v1/sessions

Create a conversation session for multi-turn queries.

### GET /api/v1/sessions/{session_id}

Get session history.

### DELETE /api/v1/sessions/{session_id}

End a session.

### GET /api/v1/sessions

List all active sessions.

---

## MCP Server

The MCP server exposes InsightGraph as a tool server for Claude Desktop and IDE extensions.

### Running the MCP Server

```bash
uv run python -m insightgraph_mcp.server
```

### Available Tools

| Tool | Description | Input |
|------|-------------|-------|
| `search_documents` | Hybrid/vector/graph search | `query`, `top_k`, `mode` |
| `find_entities` | Entity lookup | `name`, `type`, `limit` |
| `get_entity_details` | Full entity profile | `entity_name` |
| `get_claims_about` | Claims about entity | `entity_name`, `claim_type` |
| `get_metric_history` | Metric values over time | `metric_name`, `entity_name` |
| `find_evidence` | Source evidence for claim | `claim_id` |
| `list_reports` | List all reports | (none) |
| `analyze_question` | Full agent pipeline | `question` |

### Claude Desktop Configuration

```json
{
  "mcpServers": {
    "insightgraph": {
      "command": "uv",
      "args": ["run", "python", "-m", "insightgraph_mcp.server"],
      "cwd": "/path/to/InsightGraph"
    }
  }
}
```
