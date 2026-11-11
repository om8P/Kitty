import type { Database, Queryable } from "@/domain/ports";
import { pgConfig } from "./connection";
import { SCHEMA_STATEMENTS } from "./schema";

/**
 * One database handle per process.
 *
 * With DATABASE_URL set it is a `pg` pool (Supabase when hosted, Docker
 * locally). With no DATABASE_URL it is PGlite, a real Postgres compiled to
 * WebAssembly that stores its files in `.data/`, so the app runs after
 * `npm install` with nothing else to set up.
 */

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

async function open(): Promise<Database> {
  const config = pgConfig();
  const database = config ? await openPg(config) : await openPglite(process.env.KITTY_DATA_DIR ?? ".data/pglite");
  for (const statement of SCHEMA_STATEMENTS) await database.query(statement);
  return database;
}

async function openPg(config: NonNullable<ReturnType<typeof pgConfig>>): Promise<Database> {
  const { Pool } = await import("pg");
  const pool = new Pool({ ...config, max: 5, connectionTimeoutMillis: 10_000 });
  // An idle client that errors must not crash the process.
  pool.on("error", () => undefined);

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

/** `dataDir` undefined keeps everything in memory, which the tests use. */
export async function openPglite(dataDir?: string): Promise<Database> {
  const { PGlite } = await import("@electric-sql/pglite");
  if (dataDir) {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(dataDir, { recursive: true });
  }
  const pglite = new PGlite(dataDir);
  await pglite.waitReady;

  return {
    async query<T>(sql: string, params: unknown[] = []) {
      const result = await pglite.query(sql, params);
      return result.rows as T[];
    },
    transaction<T>(fn: (tx: Queryable) => Promise<T>) {
      return pglite.transaction((tx) =>
        fn({
          async query<R>(sql: string, params: unknown[] = []) {
            const result = await tx.query(sql, params);
            return result.rows as R[];
          },
        }),
      ) as Promise<T>;
    },
  };
}

/** A fresh in-memory database with the schema applied, for tests. */
export async function openTestDatabase(): Promise<Database> {
  const database = await openPglite();
  for (const statement of SCHEMA_STATEMENTS) await database.query(statement);
  return database;
}
