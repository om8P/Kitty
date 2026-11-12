/**
 * Prints the PRD's delegation follow-through metric (S49) for the database in
 * `DATABASE_URL`:
 *
 *   npx tsx scripts/metrics/delegation.ts
 *
 * It reads `.env` itself, prints counts only, and never prints a secret or a
 * household ID.
 */
import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");

async function main() {
  const { getDatabase } = await import("../../src/db/client");
  const { delegationFollowThrough } = await import("../../src/domain/metrics");
  const db = await getDatabase();
  const result = await delegationFollowThrough(db);
  const share = result.share === null ? "no households yet" : `${(result.share * 100).toFixed(1)}%`;
  console.log(`Demo households:                 ${result.households}`);
  console.log(`Opened a pool at PayPal:         ${result.openedPool}`);
  console.log(`Opened a pool and delegated:     ${result.delegated}`);
  console.log(`Delegation follow-through:       ${share}`);
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error("Couldn't read the metric:", error instanceof Error ? error.message : "unknown error");
  process.exit(1);
});
