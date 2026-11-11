import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit generates SQL migrations from `src/db/schema.ts` into `drizzle/`
 * (`npm run db:generate`). It needs no database. Review every generated file,
 * and keep table names unqualified: the tests run each in its own schema.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  strict: true,
  verbose: true,
});
