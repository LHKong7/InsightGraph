import neo4j, { Driver, Session, SessionConfig, Integer } from "neo4j-driver";

/**
 * Recursively convert Neo4j Integer objects to JS numbers and
 * strip other driver-specific wrappers so the result is plain JSON-safe.
 */
export function toPlainObject(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Integer.isInteger(value)) return (value as Integer).toNumber();
  if (Array.isArray(value)) return value.map(toPlainObject);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = toPlainObject(v);
    }
    return result;
  }
  return value;
}

export class Neo4jConnection {
  private driver: Driver;

  constructor(uri: string, user: string, password: string) {
    this.driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  }

  async verifyConnectivity(): Promise<void> {
    await this.driver.verifyConnectivity();
  }

  session(config?: SessionConfig): Session {
    return this.driver.session(config);
  }

  async close(): Promise<void> {
    await this.driver.close();
  }
}
