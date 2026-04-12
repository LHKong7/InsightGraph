# @insightgraph/sdk-embedded

Embed the full InsightGraph pipeline (parse → extract → resolve → write graph → query) **in-process** inside your Electron or Node.js application. No HTTP server, no child process — just `new InsightGraph(config)` and you're holding the entire knowledge-graph stack as a first-class TypeScript object.

> **Looking for the REST client?** Use [`insightgraph-sdk`](../sdk) instead. This package is for consumers who want to own the Neo4j driver and run the pipeline themselves.

## Install

```bash
pnpm add @insightgraph/sdk-embedded
```

You'll also need:
- **Node.js ≥ 20** (for native `fetch`)
- **Neo4j ≥ 5** reachable via Bolt (default `bolt://localhost:7687`)
- An OpenAI-compatible LLM endpoint + API key (OpenAI, DeepSeek, Ollama, vLLM, etc.)

## Quick start

```ts
import { InsightGraph } from "@insightgraph/sdk-embedded";

const ig = new InsightGraph({
  neo4j: { uri: "bolt://localhost:7687", user: "neo4j", password: "insightgraph" },
  llm:   { model: "gpt-4o-mini", apiKey: process.env.OPENAI_API_KEY },
  domain: "stock_analysis",         // or "restaurant_analysis" / "default"
  uploadDir: "/tmp/insightgraph",
});

await ig.initialize();              // connect to Neo4j, ensure schema

ig.on("progress", (ev) => {
  console.log(`[${ev.stage}]`, ev.reportId);
});

// Ingest a file (MD / PDF / CSV / JSON / XLSX)
const { reportId, entities, claims, relationships } = await ig.ingest({
  filePath: "/path/to/report.md",
});

// Query the graph
const nvidia   = await ig.findEntities({ name: "NVIDIA" });
const claims2  = await ig.getClaimsAbout("NVIDIA");
const profile  = await ig.getEntityProfile("NVIDIA");

// Graph RAG
const answer = await ig.agentQuery("Why did NVIDIA stock rise in Q3?");
console.log(answer.answer, answer.confidence, answer.verified);

await ig.close();
```

## Electron main process

```ts
import { app, ipcMain, BrowserWindow } from "electron";
import { InsightGraph } from "@insightgraph/sdk-embedded";

let ig: InsightGraph;
let mainWindow: BrowserWindow;

app.whenReady().then(async () => {
  mainWindow = new BrowserWindow({ /* ... */ });

  ig = new InsightGraph({
    neo4j: { uri: "bolt://localhost:7687", user: "neo4j", password: "insightgraph" },
    llm:   { model: "deepseek-chat", apiKey: process.env.DEEPSEEK_KEY,
             baseUrl: "https://api.deepseek.com" },
    domain: "stock_analysis",
    uploadDir: `${app.getPath("userData")}/uploads`,
  });
  await ig.initialize();

  // Forward progress events to the renderer
  ig.on("progress", (ev) => mainWindow.webContents.send("ingest-progress", ev));
});

ipcMain.handle("ingest", async (_e, { buffer, filename }) => {
  return ig.ingest({ buffer: Buffer.from(buffer), filename });
});

ipcMain.handle("ask", async (_e, question: string) => {
  return ig.agentQuery(question);
});

ipcMain.handle("find-entities", async (_e, name: string) => {
  return ig.findEntities({ name });
});

app.on("will-quit", async () => { await ig.close(); });
```

## Node.js server (Express example)

```ts
import express from "express";
import multer from "multer";
import { InsightGraph } from "@insightgraph/sdk-embedded";

const app = express();
const upload = multer({ dest: "/tmp/uploads" });

const ig = new InsightGraph({ /* ... */ });
await ig.initialize();

app.post("/upload", upload.single("file"), async (req, res) => {
  const result = await ig.ingest({ filePath: req.file!.path });
  res.json(result);
});

app.get("/ask", async (req, res) => {
  const answer = await ig.agentQuery(String(req.query.q));
  res.json(answer);
});

app.listen(3000);
```

## API

### `new InsightGraph(config?)`

| Config field | Env var fallback | Default |
|---|---|---|
| `neo4j.uri` | `IG_NEO4J_URI` | `bolt://localhost:7687` |
| `neo4j.user` | `IG_NEO4J_USER` | `neo4j` |
| `neo4j.password` | `IG_NEO4J_PASSWORD` | `insightgraph` |
| `llm.model` | `IG_LLM_MODEL` | `gpt-4o-mini` |
| `llm.apiKey` | `IG_LLM_API_KEY` | *(empty)* |
| `llm.baseUrl` | `IG_LLM_BASE_URL` | *(empty, OpenAI default)* |
| `domain` | `IG_DOMAIN` | `default` |
| `uploadDir` | `IG_UPLOAD_DIR` | `/tmp/insightgraph/uploads` |
| `extraction.batchSize` | `IG_EXTRACTION_BATCH_SIZE` | `5` |
| `extraction.maxConcurrency` | `IG_EXTRACTION_MAX_CONCURRENCY` | `5` |

### Lifecycle

- `await ig.initialize()` — open Neo4j driver, ensure schema, warm session manager. **Idempotent.**
- `await ig.close()` — close Neo4j driver.

### Ingestion

- `ig.ingest({ filePath })` — use a file already on disk.
- `ig.ingest({ buffer, filename })` — stage an in-memory buffer (Electron drag-drop).
- Both return `{ reportId, entities, metrics, claims, relationships, edges, ... }`.

Supported extensions: `.pdf`, `.csv`, `.json`, `.md`, `.markdown`, `.xlsx`, `.xls`.

### Events

Extends `EventEmitter`. Emits:

| Event | Payload |
|---|---|
| `progress` | `ProgressEvent` — fires for every stage transition |
| `parsing` / `extracting` / `resolving` / `writing` / `completed` / `failed` | same `ProgressEvent` filtered to that stage |
| `warning` | `string` — non-fatal startup issues (e.g. Neo4j connectivity check failed) |

```ts
ig.on("progress", (ev) => console.log(ev.stage, ev.reportId));
ig.on("completed", (ev) => console.log("done:", ev.entities, "entities"));
```

### Graph queries

- `findEntities({ name, type, limit })`
- `getEntity(entityId)` / `getEntityProfile(entityName)`
- `getClaimsAbout(entityName)`
- `getEntityMetrics(entityName)` / `getMetricHistory(metricName, entityName?)`
- `findEvidenceForClaim(claimId)`
- `getSubgraph(nodeId, depth?)`
- `listReports()` / `getReport(reportId)`
- `getEntityRelationships(entityName)` / `findPath(entityA, entityB, maxDepth?)`
- `compareEntityAcrossReports(entityName)` / `entityTimeline(entityName)`
- `findMetricTrend(entityName, metricName)`
- `findContradictions(entityName)` *(LLM-powered)*

### Agent RAG

- `agentQuery(question, sessionId?)` — runs Planner → Retriever → Analyst → Verifier.
  Returns `{ answer, keyFindings, evidence, confidence, verified, questionType, stepsExecuted }`.
- `createSession()` / `getSession(id)` / `deleteSession(id)` — multi-turn conversation state.

## Low-level escape hatch

If you need to compose your own pipeline, every underlying class is re-exported:

```ts
import {
  ParserService,
  ExtractionPipeline,
  ResolverService,
  Neo4jConnection,
  GraphWriter,
  GraphReader,
  HybridRetriever,
  Orchestrator,
} from "@insightgraph/sdk-embedded";
```

`runPipeline(stagedPath, reportId, settings, { emit, neo4j, domainConfig })` is also exported for callers who manage their own Neo4j connection pool.

## Footprint note

This package transitively pulls in:

- `neo4j-driver` (~1 MB)
- `unpdf` (pdf.js, ~3 MB)
- `xlsx` (~1 MB)
- `csv-parse`, `yaml`, `dotenv`

If your consumer only needs HTTP access to an already-running InsightGraph server, use [`insightgraph-sdk`](../sdk) which is dependency-free.

## License

MIT
