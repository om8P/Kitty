/**
 * Applies the SQL migrations in `drizzle/` with Drizzle's migrator
 * (architecture 2, ADR-0010). The app runs this once at startup, the tests run
 * it for each test schema, and `npm run db:migrate` runs it by hand.
 *
 * Drizzle applies every pending file in one transaction and records it in
 * `<migrationsSchema>.__drizzle_migrations`. An advisory lock stops two
 * processes from migrating the same schema at once.
 */
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool } from "pg";

/** Where the migration files live: `drizzle/` at the app root, also inside the Docker image. */
export const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

export async function runMigrations(pool: Pool, options: { migrationsSchema?: string } = {}): Promise<void> {
  const migrationsSchema = options.migrationsSchema ?? "drizzle";
  const lockName = `kitty-migrate:${migrationsSchema}`;
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [lockName]);
    try {
      await migrate(drizzle({ client }), { migrationsFolder: MIGRATIONS_FOLDER, migrationsSchema });
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockName]);
    }
  } finally {
    client.release();
  }
}
