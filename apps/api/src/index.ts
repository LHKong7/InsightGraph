import { serve } from "@hono/node-server";
import { getSettings } from "@insightgraph/core";
import { loadOntology } from "@insightgraph/core";
import { Neo4jConnection, ensureSchema } from "@insightgraph/graph";
import { createApp } from "./app";

async function main() {
  const settings = getSettings();
  const ontology = loadOntology();

  // Initialize Neo4j
  const neo4j = new Neo4jConnection(
    settings.neo4jUri,
    settings.neo4jUser,
    settings.neo4jPassword,
  );

  try {
    await neo4j.verifyConnectivity();
    console.log(`Connected to Neo4j at ${settings.neo4jUri}`);
  } catch (err) {
    console.warn("Neo4j connectivity check failed:", (err as Error).message);
    console.warn("Will attempt queries anyway — Neo4j may still work.");
  }

  // Ensure graph schema
  try {
    await ensureSchema(neo4j, ontology);
    console.log("Graph schema ensured");
  } catch (err) {
    console.warn("Could not ensure graph schema:", (err as Error).message);
  }

  const app = createApp(neo4j, settings);

  const port = 8000;
  console.log(`InsightGraph API starting on port ${port}`);
  serve({ fetch: app.fetch, port });

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    await neo4j.close();
    process.exit(0);
  });
}

main().catch(console.error);
