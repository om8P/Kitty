/**
 * Vitest global setup: makes sure the `kitty_test` database exists on the
 * Docker Postgres before any test runs, and removes schemas left behind by an
 * interrupted run. Fails the whole suite with one clear message when the
 * database isn't running.
 */
import { Client } from "pg";
import { DATABASE_NOT_RUNNING_MESSAGE, TEST_SCHEMA_PREFIX, testDatabaseUrl } from "../../src/db/testing-config";

export default async function setup() {
  const url = new URL(testDatabaseUrl());
  const name = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`TEST_DATABASE_URL names an unusual database: ${name}`);

  const admin = new URL(url);
  admin.pathname = "/postgres";
  const server = new Client({ connectionString: admin.toString(), connectionTimeoutMillis: 5_000 });
  try {
    await server.connect();
  } catch (error) {
    throw new Error(DATABASE_NOT_RUNNING_MESSAGE, { cause: error });
  }
  try {
    const found = await server.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (found.rowCount === 0) await server.query(`CREATE DATABASE ${name}`);
  } finally {
    await server.end();
  }

  const test = new Client({ connectionString: url.toString() });
  await test.connect();
  try {
    const leftovers = await test.query<{ nspname: string }>(
      "SELECT nspname FROM pg_namespace WHERE nspname LIKE $1",
      [`${TEST_SCHEMA_PREFIX}%`],
    );
    for (const { nspname } of leftovers.rows) await test.query(`DROP SCHEMA IF EXISTS ${nspname} CASCADE`);
  } finally {
    await test.end();
  }
}
