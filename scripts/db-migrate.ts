/**
 * Applies pending migrations from `drizzle/` to DATABASE_URL by hand
 * (`npm run db:migrate`). The app also applies them at startup, so this is for
 * local work and checks. It reads `.env` itself if one exists and prints no
 * connection details.
 */
import { existsSync } from "node:fs";
import { Pool } from "pg";
import { requireDatabaseConfig } from "../src/db/client";
import { runMigrations } from "../src/db/migrate";

if (!process.env.DATABASE_URL && existsSync(".env")) process.loadEnvFile(".env");

async function main() {
  const pool = new Pool({ ...requireDatabaseConfig(), max: 1, connectionTimeoutMillis: 10_000 });
  try {
    await runMigrations(pool);
    const { rows } = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations",
    );
    console.log(`Migrations are up to date (${rows[0].count} applied).`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error("Migration failed:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
});
