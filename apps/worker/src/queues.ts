import { Queue } from "bullmq";
import { getSettings } from "@insightgraph/core";

let _connection: { host: string; port: number } | null = null;

function getConnection() {
  if (!_connection) {
    const settings = getSettings();
    const url = new URL(settings.redisUrl);
    _connection = { host: url.hostname, port: parseInt(url.port || "6379") };
  }
  return _connection;
}

export function getParseQueue() {
  return new Queue("insightgraph-parse", { connection: getConnection() });
}

export function getBuildGraphQueue() {
  return new Queue("insightgraph-build-graph", { connection: getConnection() });
}
