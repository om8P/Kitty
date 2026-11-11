import { Client } from "pg";
import { pgConfig } from "./connection";

export type DatabaseStatus = "ok" | "error" | "unconfigured";

const TIMEOUT_MS = 5000;

/**
 * Checks that the database answers a trivial query. Returns only a status,
 * never the error text, because error messages can contain connection details.
 */
export async function pingDatabase(
  env: Record<string, string | undefined> = process.env,
): Promise<DatabaseStatus> {
  const config = pgConfig(env);
  if (!config) return "unconfigured";

  const client = new Client({
    ...config,
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
