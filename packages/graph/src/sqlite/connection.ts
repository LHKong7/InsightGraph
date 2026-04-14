import BetterSqlite3 from "better-sqlite3";
import type { Database } from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname, resolve } from "path";

/**
 * Thin wrapper around better-sqlite3. Applies PRAGMA knobs that match the
 * embedded/local-first usage profile described in the plan:
 *   - WAL for concurrent reads during writes
 *   - NORMAL synchronous for throughput
 *   - foreign_keys on (we only have application-level FKs today, but future-
 *     proofing is cheap).
 */
export class SqliteConnection {
  readonly path: string;
  private db: Database;

  constructor(path: string) {
    this.path = path;
    if (path !== ":memory:") {
      const absolute = resolve(path);
      try {
        mkdirSync(dirname(absolute), { recursive: true });
      } catch {
        // ignore — directory may already exist
      }
    }
    this.db = new BetterSqlite3(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("foreign_keys = ON");
  }

  /** Raw database handle. Callers should prefer the typed wrappers. */
  raw(): Database {
    return this.db;
  }

  async verifyConnectivity(): Promise<void> {
    // `SELECT 1` forces libsqlite to open the file and run a real query.
    this.db.prepare("SELECT 1").get();
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
