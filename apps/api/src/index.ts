import { serve } from "@hono/node-server";
import { getSettings, loadOntology } from "@insightgraph/core";
import { createGraphStore } from "@insightgraph/graph";
import { createApp } from "./app";

async function main() {
  const settings = getSettings();
  const ontology = loadOntology();

  // Select graph backend from settings (IG_GRAPH_BACKEND: neo4j|sqlite).
  const store = createGraphStore(settings);

  try {
    await store.verifyConnectivity();
    if (store.kind === "neo4j") {
      console.log(`Connected to Neo4j at ${settings.neo4jUri}`);
    } else {
      console.log(`Opened SQLite graph store at ${settings.sqlitePath}`);
    }
  } catch (err) {
    console.warn(
      `Graph connectivity check failed (${store.kind}):`,
      (err as Error).message,
    );
    console.warn("Will attempt queries anyway — backend may still work.");
  }

  // Ensure graph schema
  try {
    await store.ensureSchema(ontology);
    console.log("Graph schema ensured");
  } catch (err) {
    console.warn("Could not ensure graph schema:", (err as Error).message);
  }

  const app = createApp(store, settings);

  const port = 8000;
  console.log(`InsightGraph API starting on port ${port} (backend: ${store.kind})`);
  serve({ fetch: app.fetch, port });

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    await store.close();
    process.exit(0);
  });
}

main().catch(console.error);
