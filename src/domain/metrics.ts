/**
 * The PRD's "delegation follow-through" metric (S49): the share of demo
 * households that opened a pool at PayPal and gave someone, a person or an
 * agent, the right to spend from it. A pool only opens after its PayPal
 * approval, so `awaiting_payer` and `abandoned` pools don't count.
 */
import type { Queryable } from "./ports";

export type DelegationFollowThrough = {
  households: number;
  /** Households with at least one opened pool. */
  openedPool: number;
  /** Households with an opened pool that has at least one active member. */
  delegated: number;
  /** `delegated / households`, or null with no households yet. */
  share: number | null;
};

export async function delegationFollowThrough(db: Queryable): Promise<DelegationFollowThrough> {
  const [row] = await db.query<{ households: number; opened_pool: number; delegated: number }>(
    `SELECT
       (SELECT count(*) FROM households)::int AS households,
       (SELECT count(DISTINCT household_id) FROM pools
         WHERE status IN ('active', 'closing', 'closed'))::int AS opened_pool,
       (SELECT count(DISTINCT p.household_id) FROM pools p
         JOIN pool_members m ON m.pool_id = p.id AND m.active
         WHERE p.status IN ('active', 'closing', 'closed'))::int AS delegated`,
  );
  return {
    households: row.households,
    openedPool: row.opened_pool,
    delegated: row.delegated,
    share: row.households === 0 ? null : row.delegated / row.households,
  };
}
