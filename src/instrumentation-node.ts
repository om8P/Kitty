/**
 * Kitty keeps all data in the configured Postgres, so it refuses to start
 * without DATABASE_URL (architecture 2). Next.js only logs an error thrown in
 * the instrumentation hook and keeps serving, so exit instead.
 */
import { requireDatabaseConfig } from "@/db/client";

try {
  requireDatabaseConfig();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
