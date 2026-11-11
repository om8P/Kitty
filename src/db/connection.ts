import type { ClientConfig } from "pg";

type Env = Record<string, string | undefined>;

export type DatabaseTls = "verified" | "off";

/**
 * Builds the pg connection settings from the environment.
 *
 * Hosted databases such as Supabase sign their certificates with their own CA,
 * which Node does not trust by default. Put that CA (PEM text) in
 * DATABASE_CA_CERT to get TLS with full certificate checks. Leave it unset for
 * the local Docker database. Keep sslmode out of DATABASE_URL, because pg lets
 * URL parameters override these settings.
 */
export function pgConfig(env: Env = process.env): ClientConfig | null {
  const connectionString = env.DATABASE_URL;
  if (!connectionString) return null;

  const ca = readCa(env);
  return ca
    ? { connectionString, ssl: { ca, rejectUnauthorized: true } }
    : { connectionString };
}

export function databaseTls(env: Env = process.env): DatabaseTls {
  return readCa(env) ? "verified" : "off";
}

function readCa(env: Env): string | undefined {
  // Some dashboards store a pasted PEM with literal "\n" sequences.
  const ca = env.DATABASE_CA_CERT?.replace(/\\n/g, "\n").trim();
  return ca ? ca : undefined;
}
