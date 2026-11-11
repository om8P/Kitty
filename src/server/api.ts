import type { Capabilities } from "@/lib/views";
import type { Database } from "@/domain/ports";
import { DomainError, type MemberRow, type PoolRow } from "@/domain/types";
import type { Container } from "./container";
import type { Session } from "./session";

export function capabilitiesOf(container: Container): Capabilities {
  return {
    payments: container.rail.name,
    ai: container.model.configured,
    catalog: container.catalog.provider,
  };
}

/** Loads a pool only if it belongs to the session's household. */
export async function loadHouseholdPool(db: Database, session: Session, poolId: string): Promise<PoolRow> {
  const [pool] = await db.query<PoolRow>("SELECT * FROM pools WHERE id = $1", [poolId]);
  if (!pool || pool.household_id !== session.householdId) {
    throw new DomainError("not_found", "That pool doesn't exist.");
  }
  return pool;
}

export function requireOwner(session: Session, pool: PoolRow): void {
  if (pool.owner_user_id !== session.user.id) {
    throw new DomainError("forbidden", `Only the pool owner can do this. You're signed in as ${session.user.name}.`);
  }
}

/** The newest open pool in which the session's user is a spending member. */
export async function findMemberPool(
  db: Database,
  session: Session,
): Promise<{ pool: PoolRow; member: MemberRow } | null> {
  const [member] = await db.query<MemberRow>(
    `SELECT m.* FROM pool_members m JOIN pools p ON p.id = m.pool_id
     WHERE m.user_id = $1 AND p.household_id = $2 AND p.status = 'active'
     ORDER BY p.created_at DESC LIMIT 1`,
    [session.user.id, session.householdId],
  );
  if (!member) return null;
  const [pool] = await db.query<PoolRow>("SELECT * FROM pools WHERE id = $1", [member.pool_id]);
  return pool ? { pool, member } : null;
}
