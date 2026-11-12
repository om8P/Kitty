/**
 * A daily cap on new demo households (S51). Starting the demo needs only the
 * access code, so without a cap a leaked code could fill the free database.
 * Counted in `usage_counters`, so it holds across a restart. A count that
 * can't be written refuses, because a new household is never urgent.
 */
import type { Queryable } from "@/domain/ports";

export const DEMO_HOUSEHOLDS_PER_DAY = 300;

export async function takeDemoHousehold(
  db: Queryable,
  options: { cap?: number; now?: Date } = {},
): Promise<boolean> {
  const period = (options.now ?? new Date()).toISOString().slice(0, 10);
  try {
    const [row] = await db.query<{ count: number }>(
      `INSERT INTO usage_counters (kind, period, count) VALUES ('demo_household', $1, 1)
       ON CONFLICT (kind, period) DO UPDATE SET count = usage_counters.count + 1
       RETURNING count`,
      [period],
    );
    return row.count <= (options.cap ?? DEMO_HOUSEHOLDS_PER_DAY);
  } catch {
    return false;
  }
}
