import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import type { Logger } from "../utils/logger.js";

export class Database {
  private readonly pool: Pool;

  constructor(connectionString: string, private readonly logger: Logger) {
    this.pool = new Pool({
      connectionString,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
      statement_timeout: 15_000,
      application_name: "discord-music-bot",
      ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
    });
    this.pool.on("error", (error) => this.logger.error({ err: error }, "Unexpected PostgreSQL pool error"));
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<T>> {
    try {
      return await this.pool.query<T>(text, [...values]);
    } catch (error) {
      this.logger.error({ err: error }, "PostgreSQL query failed");
      throw error;
    }
  }

  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const value = await work(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        this.logger.error({ err: rollbackError }, "PostgreSQL transaction rollback failed");
      }
      this.logger.error({ err: error }, "PostgreSQL transaction failed");
      throw error;
    } finally {
      client.release();
    }
  }

  async migrate(): Promise<void> {
    await this.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    await this.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        migration_name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const migrationName = "001_initial.sql";
    const alreadyApplied = await this.query(
      "SELECT migration_name FROM schema_migrations WHERE migration_name = $1",
      [migrationName],
    );
    if (alreadyApplied.rowCount) return;

    const sql = await readFile(resolve(process.cwd(), "migrations", migrationName), "utf8");
    await this.transaction(async (client) => {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (migration_name) VALUES ($1)", [migrationName]);
    });
    this.logger.info({ migration: migrationName }, "Database migration applied");
  }

  async healthcheck(): Promise<void> {
    await this.query("SELECT 1");
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}