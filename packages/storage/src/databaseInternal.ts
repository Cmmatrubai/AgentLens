import type Database from "better-sqlite3";
import type { AgentLensDatabase } from "./database.js";

const connections = new WeakMap<AgentLensDatabase, Database.Database>();

export function registerConnection(
  database: AgentLensDatabase,
  connection: Database.Database
): void {
  connections.set(database, connection);
}

export function connectionFor(database: AgentLensDatabase): Database.Database {
  const connection = connections.get(database);
  if (!connection) throw new Error("AgentLens database is closed or invalid.");
  return connection;
}

export function releaseConnection(database: AgentLensDatabase): Database.Database | undefined {
  const connection = connections.get(database);
  connections.delete(database);
  return connection;
}
