# InsightGraph Electron Integration

Manage the InsightGraph Python backend lifecycle from an Electron main process.

## Two Modes

| Mode | When to use | User needs to install |
|------|-------------|----------------------|
| **binary** | App distribution | Docker only (for Neo4j/Redis) |
| **source** | Development | Python 3.11+, uv, Docker |

## Installation

```bash
npm install insightgraph-electron insightgraph-sdk
```

Or from local path:
```bash
npm install ../InsightGraph/typescript/electron-integration
npm install ../InsightGraph/typescript/sdk
```

## Quick Start (Binary Mode)

### Step 1: Build the server binary

```bash
cd InsightGraph/python
uv add --dev pyinstaller
uv run python scripts/build-binary.py
# Output: python/dist/insightgraph-server/
```

### Step 2: Copy binary to Electron app resources

Copy `python/dist/insightgraph-server/` into your Electron app's `extraResources`.

In `electron-builder.yml`:
```yaml
extraResources:
  - from: "../InsightGraph/python/dist/insightgraph-server"
    to: "insightgraph-server"
```

### Step 3: Integrate in Electron main process

```typescript
// main.ts
import path from "path";
import { app, BrowserWindow } from "electron";
import { BackendManager } from "insightgraph-electron";
import { InsightGraphClient } from "insightgraph-sdk";

const backend = new BackendManager({
  mode: "binary",
  binaryPath: path.join(
    process.resourcesPath,
    "insightgraph-server",
    "insightgraph-server"  // the executable inside the dir
  ),
  apiPort: 8000,
  startDocker: true,
  env: {
    IG_LLM_API_KEY: "your-api-key",
    IG_NEO4J_URI: "bolt://localhost:7687",
    IG_NEO4J_PASSWORD: "insightgraph",
  },
});

// Log backend output
backend.on("stdout", (data) => console.log("[backend]", data));
backend.on("stderr", (data) => console.error("[backend]", data));
backend.on("error", (err) => console.error("[backend error]", err));

app.on("ready", async () => {
  try {
    await backend.start();
    console.log(`Backend ready at ${backend.apiUrl}`);
  } catch (err) {
    console.error("Failed to start backend:", err);
    app.quit();
    return;
  }

  // Now use the SDK
  const client = new InsightGraphClient({ baseUrl: backend.apiUrl });

  // Example: upload a report
  // const result = await client.uploadReport(fileBlob, "report.pdf");

  // Example: search
  // const hits = await client.search({ query: "revenue growth" });

  // Example: agent query
  // const answer = await client.agentQuery({ question: "What drove growth?" });

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  win.loadFile("index.html");
});

app.on("will-quit", async () => {
  await backend.stop();
});
```

## Quick Start (Source Mode)

For development — requires Python and uv on the machine:

```typescript
const backend = new BackendManager({
  mode: "source",
  pythonDir: path.join(__dirname, "../../InsightGraph/python"),
  apiPort: 8000,
  startDocker: true,
  env: { IG_LLM_API_KEY: "your-api-key" },
});
```

## Environment Check

Before starting, you can verify dependencies:

```typescript
import { checkEnvironment } from "insightgraph-electron";

const check = await checkEnvironment({
  needPython: false,   // binary mode
  needDocker: true,    // need Neo4j + Redis
  binaryPath: "/path/to/insightgraph-server",
});

if (!check.ok) {
  dialog.showErrorBox(
    "Missing Dependencies",
    check.missing.join("\n")
  );
}
```

## Events

```typescript
backend.on("ready", () => {});      // Backend health check passed
backend.on("stopped", () => {});    // Backend process exited
backend.on("error", (err) => {});   // Error occurred
backend.on("stdout", (line) => {}); // Backend stdout output
backend.on("stderr", (line) => {}); // Backend stderr output
```

## API

### `BackendManager`

| Property/Method | Description |
|----------------|-------------|
| `new BackendManager(config)` | Create manager with config |
| `start()` | Start Docker + backend, wait for health |
| `stop()` | Gracefully shutdown (SIGTERM → SIGKILL) |
| `apiUrl` | `http://127.0.0.1:8000` |
| `isRunning` | Boolean status |

### `InsightGraphElectronConfig`

| Field | Default | Description |
|-------|---------|-------------|
| `mode` | required | `"source"` or `"binary"` |
| `pythonDir` | — | Python source directory (source mode) |
| `binaryPath` | — | Server binary path (binary mode) |
| `apiHost` | `127.0.0.1` | API listen host |
| `apiPort` | `8000` | API listen port |
| `startDocker` | `false` | Auto-start Neo4j + Redis |
| `env` | `{}` | Environment variables (IG_* settings) |
| `healthCheckTimeout` | `30000` | Max wait time (ms) |

## Docker Requirement

Both modes still need Docker for **Neo4j** and **Redis**. Set `startDocker: true` to auto-manage, or start them manually:

```bash
cd InsightGraph/python
docker compose up -d
```

## Troubleshooting

**"Missing dependencies: Docker"** → Install Docker Desktop

**"Backend failed to start within 30000ms"** →
- Check if port 8000 is already in use
- Increase `healthCheckTimeout`
- Check backend.on("stderr") output

**"Binary not found"** → Run `uv run python scripts/build-binary.py` first
