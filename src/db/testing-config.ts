/** Settings shared by the test database helper and the Vitest global setup. */

/** Throwaway credentials from docker-compose.yml, for the local container only. */
export const DEFAULT_TEST_DATABASE_URL = "postgresql://kitty:kitty@localhost:5432/kitty_test";

export const TEST_SCHEMA_PREFIX = "kitty_t_";

export const DATABASE_NOT_RUNNING_MESSAGE =
  "The test database isn't reachable. Start it with `docker compose up -d db` (or set TEST_DATABASE_URL), then run the tests again.";

export function testDatabaseUrl(env: Record<string, string | undefined> = process.env): string {
  return env.TEST_DATABASE_URL?.trim() || DEFAULT_TEST_DATABASE_URL;
}
