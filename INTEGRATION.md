# Integrating InsightGraph

This guide explains how to integrate InsightGraph into your application. It covers the package layout, the two integration paths (HTTP vs embedded), and concrete examples for Electron desktop apps, Node.js servers, CLI tools, and the Model Context Protocol.

---

## 1. Package overview

InsightGraph is a pnpm monorepo with two integration surfaces and six internal libraries:

```
InsightGraph/
├── sdk/                   @insightgraph/sdk           ← HTTP client
├── sdk-embedded/          @insightgraph/sdk-embedded  ← In-process full stack
│
├── packages/
│   ├── core/              @insightgraph/core          Types, config, domains, ontology, LLM wrapper
│   ├── parser/            @insightgraph/parser        PDF / CSV / JSON / MD / XLSX → DocumentIR
│   ├── extractor/         @insightgraph/extractor     LLM entity/metric/claim/relationship extraction
│   ├── resolver/          @insightgraph/resolver      Entity canonicalisation
│   ├── graph/             @insightgraph/graph         Neo4j connection + writer + reader
│   ├── retriever/         @insightgraph/retriever     Graph / hybrid retrieval + analytics + tools
│   └── agent-runtime/     @insightgraph/agent-runtime Planner → Retriever → Analyst → Verifier
│
├── apps/
│   ├── api/               Hono REST server (port 8000)
│   ├── worker/            BullMQ worker (not required for embedded use)
│   └── mcp-server/        Model Context Protocol stdio server
│
└── web/                   Next.js frontend
```

---

## 2. Which path should I use?

| Your situation | Use |
|---|---|
| You already run the Hono API (`apps/api`) and want to call it from anywhere. | **`@insightgraph/sdk`** (HTTP) |
| You want to embed the full pipeline inside an Electron main process. | **`@insightgraph/sdk-embedded`** |
| You're adding knowledge-graph capabilities to an existing Node.js server (Express / Fastify / Hono / Nest). | **`@insightgraph/sdk-embedded`** |
| You want to expose retrieval tools to Claude / other LLM clients. | Use **`apps/mcp-server`** as a reference, or embed `AgentTools` directly. |
| You're writing a browser app. | **`@insightgraph/sdk`** + the Hono API as a backend. (Embedded SDK is Node-only — it needs `neo4j-driver`, `fs`, etc.) |

**Rule of thumb:** use the HTTP SDK when there's a process/security boundary between caller and Neo4j; use the embedded SDK when the caller already owns the Neo4j credentials.

---

## 3. Path A — HTTP integration (`@insightgraph/sdk`)

Zero-dep client. Talks to a running Hono API.

### Install

```bash
pnpm add @insightgraph/sdk
```

### Minimal example

```ts
import { InsightGraphClient } from "@insightgraph/sdk";

const client = new InsightGraphClient({ baseUrl: "http://localhost:8000" });

const results = await client.search({ query: "revenue growth", mode: "hybrid" });

const answer = await client.agentQuery({ question: "What drove revenue growth?" });
console.log(answer.answer, answer.confidence);

// Multi-turn session
const session = await client.createSession();
const a1 = await client.agentQuery({ question: "Tell me about NVIDIA", session_id: session.session_id });
const a2 = await client.agentQuery({ question: "What are its key risks?", session_id: session.session_id });
```

### File upload

```ts
const form = new FormData();
form.append("file", fileInputOrBlob);
const res = await fetch(`${API_BASE}/api/v1/reports/upload`, { method: "POST", body: form });
const { report_id } = await res.json();

// Poll until done
let status;
do {
  await new Promise(r => setTimeout(r, 2000));
  status = await fetch(`${API_BASE}/api/v1/reports/${report_id}/status`).then(r => r.json());
} while (status.status !== "completed" && status.status !== "failed");
```

### Running the server

```bash
# From project root
./scripts/start-infra.sh        # Neo4j + Redis via docker compose
./scripts/start-api.sh          # Hono API on :8000
```

The API reads configuration from `.env` — see `.env.example` for the full list of `IG_*` variables.

---

## 4. Path B — Embedded integration (`@insightgraph/sdk-embedded`)

Owns the pipeline in your process. No separate server, no HTTP hop.

### Install

```bash
pnpm add @insightgraph/sdk-embedded
```

You'll still need:
- **Node.js ≥ 20**
- **Neo4j ≥ 5** reachable via Bolt
- An **OpenAI-compatible** LLM endpoint (OpenAI, DeepSeek, vLLM, Ollama, Azure OpenAI, …)

### Lifecycle

```ts
import { InsightGraph } from "@insightgraph/sdk-embedded";

const ig = new InsightGraph({
  neo4j: { uri: "bolt://localhost:7687", user: "neo4j", password: "insightgraph" },
  llm:   { model: "gpt-4o-mini", apiKey: process.env.OPENAI_API_KEY },
  domain: "stock_analysis",   // or "restaurant_analysis" / "default" / DomainConfig
  uploadDir: "/tmp/insightgraph",
});

await ig.initialize();   // connects Neo4j, ensures schema — idempotent

// ... use ig ...

await ig.close();        // shut down cleanly
```

### Ingest a file

```ts
ig.on("progress", (ev) => console.log(`[${ev.stage}] ${ev.reportId}`));

// From disk
const r1 = await ig.ingest({ filePath: "/path/to/report.pdf" });

// From memory (Electron drag-drop, multipart upload, etc.)
const r2 = await ig.ingest({ buffer: fileBuffer, filename: "Q3-report.md" });

console.log(r1.entities, "entities,", r1.relationships, "relationships");
```

Supported extensions: `.pdf .csv .json .md .markdown .xlsx .xls`.

### Query the graph

```ts
const found   = await ig.findEntities({ name: "NVIDIA", limit: 10 });
const profile = await ig.getEntityProfile("NVIDIA");     // claims + metrics + relationships
const claims  = await ig.getClaimsAbout("NVIDIA");
const metrics = await ig.getMetricHistory("Revenue", "NVIDIA");
const path    = await ig.findPath("NVIDIA", "TSMC");
```

### Agent RAG

```ts
const answer = await ig.agentQuery("What drove NVIDIA stock to rise in Q3?");
// answer = { answer, keyFindings, evidence, confidence, verified, questionType, stepsExecuted }
```

### Full config reference

| Path | Env fallback | Default |
|---|---|---|
| `neo4j.uri` | `IG_NEO4J_URI` | `bolt://localhost:7687` |
| `neo4j.user` | `IG_NEO4J_USER` | `neo4j` |
| `neo4j.password` | `IG_NEO4J_PASSWORD` | `insightgraph` |
| `llm.model` | `IG_LLM_MODEL` | `gpt-4o-mini` |
| `llm.apiKey` | `IG_LLM_API_KEY` | *(empty)* |
| `llm.baseUrl` | `IG_LLM_BASE_URL` | *(OpenAI default)* |
| `domain` | `IG_DOMAIN` | `default` |
| `uploadDir` | `IG_UPLOAD_DIR` | `/tmp/insightgraph/uploads` |
| `extraction.batchSize` | `IG_EXTRACTION_BATCH_SIZE` | `5` |
| `extraction.maxConcurrency` | `IG_EXTRACTION_MAX_CONCURRENCY` | `5` |

---

## 5. Integration recipes

### 5.1 Electron main process

```ts
// main.ts
import { app, BrowserWindow, ipcMain } from "electron";
import { InsightGraph } from "@insightgraph/sdk-embedded";

let ig: InsightGraph;
let win: BrowserWindow;

app.whenReady().then(async () => {
  win = new BrowserWindow({ /* … */ });

  ig = new InsightGraph({
    neo4j: { uri: "bolt://localhost:7687", user: "neo4j", password: "insightgraph" },
    llm:   { model: "deepseek-chat",
             apiKey: process.env.DEEPSEEK_KEY,
             baseUrl: "https://api.deepseek.com" },
    domain: "stock_analysis",
    uploadDir: `${app.getPath("userData")}/uploads`,
  });
  await ig.initialize();

  ig.on("progress", (ev) => win.webContents.send("ingest-progress", ev));
});

ipcMain.handle("ingest", async (_e, { buffer, filename }) =>
  ig.ingest({ buffer: Buffer.from(buffer), filename }),
);
ipcMain.handle("ask",   async (_e, question: string) => ig.agentQuery(question));

app.on("will-quit", async () => { await ig.close(); });
```

Renderer code talks to the main process via `ipcRenderer.invoke("ingest", …)` — no sockets, no HTTP.

### 5.2 Add to an existing Express server

```ts
import express from "express";
import multer from "multer";
import { InsightGraph } from "@insightgraph/sdk-embedded";

const app = express();
const upload = multer({ dest: "/tmp/uploads" });
const ig = new InsightGraph({ /* … */ });

async function bootstrap() {
  await ig.initialize();

  app.post("/reports", upload.single("file"), async (req, res) => {
    const result = await ig.ingest({ filePath: req.file!.path });
    res.json(result);
  });

  app.get("/ask", async (req, res) => {
    res.json(await ig.agentQuery(String(req.query.q)));
  });

  app.listen(3000);
}

bootstrap();
process.on("SIGTERM", () => ig.close());
```

### 5.3 Composing low-level pieces

If you need to skip parts of the pipeline (e.g. you already have a `DocumentIR`), reach for the building blocks:

```ts
import {
  ExtractionPipeline,
  ResolverService,
  Neo4jConnection,
  GraphWriter,
  createSettings,
  loadDomainConfig,
} from "@insightgraph/sdk-embedded";

const settings = createSettings({
  neo4jPassword: "mypass",
  llmModel: "gpt-4o-mini",
  llmApiKey: process.env.OPENAI_API_KEY!,
});

const extractor = new ExtractionPipeline(
  settings.llmModel, settings.llmApiKey, settings.llmBaseUrl,
  loadDomainConfig(settings.domain),
);
const resolver = new ResolverService(
  settings.llmModel, settings.llmApiKey, settings.llmBaseUrl,
);

const extractions  = await extractor.extract(myDocumentIR);
const resolved     = await resolver.resolve(extractions);

const conn = new Neo4jConnection(settings.neo4jUri, settings.neo4jUser, settings.neo4jPassword);
try {
  await new GraphWriter(conn).writeDocument(myDocumentIR, resolved);
} finally {
  await conn.close();
}
```

### 5.4 Running only the pipeline (no class)

```ts
import { runPipeline, getSettings, Neo4jConnection } from "@insightgraph/sdk-embedded";

const settings = getSettings();   // or createSettings({...})
const conn = new Neo4jConnection(settings.neo4jUri, settings.neo4jUser, settings.neo4jPassword);

const result = await runPipeline("/tmp/report.md", "some-uuid", settings, {
  neo4j: conn,
  emit: (ev) => console.log(ev.stage),
});

await conn.close();
```

### 5.5 MCP (Model Context Protocol) server

`apps/mcp-server` already does this. Reference pattern:

```ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { InsightGraph } from "@insightgraph/sdk-embedded";

const ig = new InsightGraph({ /* … */ });
await ig.initialize();

const server = new Server({ name: "insightgraph", version: "1.0.0" });

server.setRequestHandler(/* ListToolsRequestSchema */, async () => ({
  tools: [/* find_entities, get_entity_profile, agent_query, … */],
}));

server.setRequestHandler(/* CallToolRequestSchema */, async (req) => {
  const { name, arguments: args } = req.params;
  switch (name) {
    case "find_entities":   return ig.findEntities(args);
    case "agent_query":     return ig.agentQuery(args.question);
    // …
  }
});

await server.connect(new StdioServerTransport());
```

Claude Desktop picks this up via its `claude_desktop_config.json` — see `apps/mcp-server/README.md` if present.

---

## 6. Sharing types between client and server

The two SDKs define parallel but overlapping types. A good pattern is to pull **API contract types** from the HTTP SDK and **internal IR types** from the embedded SDK:

```ts
// API response shapes (report, entity, claim, …)
import type { Entity, Claim, MetricValue, AgentResponse } from "@insightgraph/sdk";

// Pipeline-internal shapes (DocumentIR, ExtractionResult, …)
import type { DocumentIR, ExtractionResult, DomainConfig } from "@insightgraph/sdk-embedded";
```

Both re-export from the shared `@insightgraph/core` types, so equivalent names refer to the same structures.

---

## 7. Running the development stack

```bash
# One-off
pnpm install
pnpm run build

# Infrastructure (Neo4j + Redis)
./scripts/start-infra.sh

# API + worker + web frontend (hot reload)
./scripts/start-all.sh

# Individual services
./scripts/start-api.sh
./scripts/start-worker.sh
./scripts/start-web.sh
./scripts/start-mcp.sh

# Introspect background jobs
./scripts/jobs.sh                       # list all jobs
./scripts/jobs.sh <report_id>           # single job detail
```

---

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Neo4j connectivity check failed: The client is unauthorized` | `.env` password doesn't match the Neo4j container password | Align `IG_NEO4J_PASSWORD` with `NEO4J_AUTH` in `docker-compose.yml`, or recreate the container with `docker compose down -v && docker compose up -d`. |
| Extraction hangs at "extracting" forever | LLM base URL or key wrong; network blocked; or slow reasoning model | Set `llm.baseUrl` / `llm.apiKey` explicitly. Test connectivity with `curl https://api.openai.com/v1/models -H "Authorization: Bearer $KEY"`. Prefer `deepseek-chat` over `deepseek-reasoner` for batch extraction. |
| `Pipeline exited with code 1` in API logs | Child-process failure; real error is in API's stderr | Check `/tmp/ig-api.log` — the `[pipeline:*:err]` lines contain the stack trace. The `/api/v1/reports/:id/status` response also now includes up to 600 chars of stderr. |
| `LIMIT: Invalid input. '50.0' is not a valid value` | Neo4j driver sending float instead of integer for LIMIT | Already fixed — rebuild with `pnpm run build`. |
| Force-graph-container renders tiny | `body`/`main` flex chain broken | Already fixed in `web/src/app/layout.tsx` (uses `h-full overflow-hidden`). |

---

## 9. Where to look next

- `README.md` — project overview + tech stack.
- `sdk/README.md` *(if present)* — REST endpoint reference.
- `sdk-embedded/README.md` — embedded API reference, footprint notes.
- `docs/architecture.md` — data flow + graph model.
- `docs/api-reference.md` — full REST endpoint spec.
- `docs/ontology.md` — node / edge definitions.
