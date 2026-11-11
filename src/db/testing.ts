/**
 * Test databases on real Postgres (architecture 2, Tests row). Each call gets
 * its own schema in the `kitty_test` database on the Docker Postgres, so test
 * files can run in parallel and a test never sees another test's rows. The
 * schema is dropped when the test finishes. Only tests import this file.
 */
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { onTestFinished } from "vitest";
import type { Database, Queryable } from "@/domain/ports";
import { wrapPool } from "./client";
import { SCHEMA_STATEMENTS } from "./schema";
import { DATABASE_NOT_RUNNING_MESSAGE, TEST_SCHEMA_PREFIX, testDatabaseUrl } from "./testing-config";

export type TestDatabaseOptions = {
  /**
   * Inside a transaction, pause for `ms` after any statement matching
   * `after`, so a concurrent transaction is sure to arrive while this one
   * still holds its locks. Race tests use it to prove the pool lock works.
   */
  pauses?: { after: RegExp; ms: number }[];
};

/** A fresh, empty database with the schema applied, dropped when the test ends. */
export async function openTestDatabase(options: TestDatabaseOptions = {}): Promise<Database> {
  const schema = `${TEST_SCHEMA_PREFIX}${randomUUID().replace(/-/g, "")}`;
  const pool = new Pool({
    connectionString: testDatabaseUrl(),
    max: 6,
    idleTimeoutMillis: 1_000,
    connectionTimeoutMillis: 5_000,
    options: `-c search_path=${schema}`,
  });
  pool.on("error", () => undefined);

  try {
    await pool.query(`CREATE SCHEMA ${schema}`);
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw new Error(DATABASE_NOT_RUNNING_MESSAGE, { cause: error });
  }

  onTestFinished(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined);
    await pool.end().catch(() => undefined);
  });

  const database = wrapPool(pool);
  for (const statement of SCHEMA_STATEMENTS) await database.query(statement);
  return options.pauses?.length ? withPauses(database, options.pauses) : database;
}

function withPauses(database: Database, pauses: { after: RegExp; ms: number }[]): Database {
  return {
    query: database.query.bind(database),
    transaction<T>(fn: (tx: Queryable) => Promise<T>) {
      return database.transaction((tx) =>
        fn({
          async query<R>(sql: string, params?: unknown[]) {
            const rows = await tx.query<R>(sql, params);
            const pause = pauses.find((candidate) => candidate.after.test(sql));
            if (pause) await new Promise((resolve) => setTimeout(resolve, pause.ms));
            return rows;
          },
        }),
      );
    },
  };
}
