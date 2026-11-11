import type { Pool } from "pg";
import type { Database, Queryable } from "@/domain/ports";
import { pgConfig } from "./connection";
import { SCHEMA_STATEMENTS } from "./schema";

/**
 * One database handle per process: a `pg` pool on DATABASE_URL (Supabase when
 * hosted, the Docker database locally). There is no fallback, so the app
 * never keeps data outside the configured Postgres.
 */

export const MISSING_DATABASE_MESSAGE =
  "DATABASE_URL is not set. For local work run `docker compose up -d db` and set DATABASE_URL in .env (see .env.example).";

type Store = { database?: Promise<Database> };
const store = globalThis as typeof globalThis & { __kittyDb?: Store };

export function getDatabase(): Promise<Database> {
  store.__kittyDb ??= {};
  store.__kittyDb.database ??= open().catch((error) => {
    // Let the next request try again instead of caching the failure.
    if (store.__kittyDb) store.__kittyDb.database = undefined;
    throw error;
  });
  return store.__kittyDb.database;
}

/** Throws with a clear message when DATABASE_URL is missing. Called at startup. */
export function requireDatabaseConfig(env: Record<string, string | undefined> = process.env) {
  const config = pgConfig(env);
  if (!config) throw new Error(MISSING_DATABASE_MESSAGE);
  return config;
}

async function open(): Promise<Database> {
  const config = requireDatabaseConfig();
  const { Pool } = await import("pg");
  const pool = new Pool({ ...config, max: 5, connectionTimeoutMillis: 10_000 });
  // An idle client that errors must not crash the process.
  pool.on("error", () => undefined);
  const database = wrapPool(pool);
  for (const statement of SCHEMA_STATEMENTS) await database.query(statement);
  return database;
}

/** Adapts a `pg` pool to the domain's Database port. Each transaction uses one client. */
export function wrapPool(pool: Pool): Database {
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      const result = await pool.query(sql, params);
      return result.rows as T[];
    },
    async transaction<T>(fn: (tx: Queryable) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const value = await fn({
          async query<R>(sql: string, params: unknown[] = []) {
            const result = await client.query(sql, params);
            return result.rows as R[];
          },
        });
        await client.query("COMMIT");
        return value;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
