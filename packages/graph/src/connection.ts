import neo4j, { Driver, Session, SessionConfig } from "neo4j-driver";

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
