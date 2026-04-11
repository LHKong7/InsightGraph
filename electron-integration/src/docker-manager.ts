import { exec } from "node:child_process";
import { createConnection } from "node:net";

export class DockerManager {
  constructor(
    private composePath: string,
    private neo4jPort: number,
    private redisPort: number,
  ) {}

  /** Start Neo4j + Redis via docker compose. */
  async start(): Promise<void> {
    await this.exec(`docker compose -f "${this.composePath}" up -d`);
    // Wait for ports to become reachable
    await Promise.all([
      this.waitForPort(this.neo4jPort, 30_000),
      this.waitForPort(this.redisPort, 15_000),
    ]);
  }

  /** Stop Docker services. */
  async stop(): Promise<void> {
    await this.exec(`docker compose -f "${this.composePath}" down`);
  }

  /** Check if Neo4j and Redis ports are reachable. */
  async isRunning(): Promise<boolean> {
    const [neo4j, redis] = await Promise.all([
      this.portReachable(this.neo4jPort),
      this.portReachable(this.redisPort),
    ]);
    return neo4j && redis;
  }

  private exec(cmd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      exec(cmd, { timeout: 60_000 }, (err, stdout, stderr) => {
        if (err) reject(new Error(`${cmd} failed: ${stderr || err.message}`));
        else resolve(stdout);
      });
    });
  }

  private portReachable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const sock = createConnection({ port, host: "127.0.0.1", timeout: 2_000 });
      sock.on("connect", () => {
        sock.destroy();
        resolve(true);
      });
      sock.on("error", () => resolve(false));
      sock.on("timeout", () => {
        sock.destroy();
        resolve(false);
      });
    });
  }

  private async waitForPort(port: number, timeout: number): Promise<void> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await this.portReachable(port)) return;
      await new Promise((r) => setTimeout(r, 1_000));
    }
    throw new Error(`Port ${port} not reachable after ${timeout}ms`);
  }
}
