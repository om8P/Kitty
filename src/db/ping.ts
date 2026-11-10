import { Client } from "pg";

export type DatabaseStatus = "ok" | "error" | "unconfigured";

const TIMEOUT_MS = 2000;

/**
 * Checks that the database answers a trivial query. Returns only a status,
 * never the error text, because error messages can contain connection details.
 */
export async function pingDatabase(
  databaseUrl: string | undefined = process.env.DATABASE_URL,
): Promise<DatabaseStatus> {
  if (!databaseUrl) return "unconfigured";

  const client = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: TIMEOUT_MS,
    query_timeout: TIMEOUT_MS,
  });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return "ok";
  } catch {
    return "error";
  } finally {
    await client.end().catch(() => undefined);
  }
}
