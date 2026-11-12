/**
 * Changing who can spend after a pool opens (plan step S25).
 *
 * Every change locks the pool row first, the same lock every fund movement
 * takes, so a rule change and a purchase can never interleave. Members are
 * never deleted: removing one marks it inactive, and the hard rules then stop
 * its purchases and any approval of them (architecture 5.3, 7.1).
 */
import { formatUsd } from "./money";
import type { Database, Queryable } from "./ports";
import { poolAvailable } from "./rules";
import { isStore, SELECT_MEMBERS } from "./stores";
import { DomainError, newId, poolFunds, type MemberRow, type PoolRow } from "./types";

export type MemberRules = {
  limitCents: number;
  approvalThresholdCents: number;
  allowedStores: string[];
};

/** Changes a member's limit, approval amount and allowed stores. */
export async function updateMember(
  db: Database,
  input: { poolId: string; memberId: string; userId: string; rules: MemberRules },
): Promise<MemberRow> {
  validateRules(input.rules);
  return db.transaction(async (tx) => {
    const pool = await lockOwnedOpenPool(tx, input.poolId, input.userId);
    const member = await loadMember(tx, pool.id, input.memberId);
    if (!member.active) {
      throw new DomainError("conflict", `${member.label} was removed from this pool. Add them back first.`);
    }
    checkLimit(pool, member, input.rules.limitCents);
    await writeRules(tx, member.id, input.rules, true);
    return loadMember(tx, pool.id, member.id);
  });
}

/** Stops a member from spending. The row and what they already spent stay. */
export async function removeMember(
  db: Database,
  input: { poolId: string; memberId: string; userId: string },
): Promise<MemberRow> {
  return db.transaction(async (tx) => {
    const pool = await lockOwnedOpenPool(tx, input.poolId, input.userId);
    const member = await loadMember(tx, pool.id, input.memberId);
    if (!member.active) throw new DomainError("conflict", `${member.label} is already removed from this pool.`);
    await tx.query("UPDATE pool_members SET active = false WHERE id = $1", [member.id]);
    return loadMember(tx, pool.id, member.id);
  });
}

/**
 * Adds the household's family member or the shopping agent. A pool has at most
 * one of each, as when it was created. A removed member is switched back on,
 * so what they already spent still counts against their limit.
 */
export async function addMember(
  db: Database,
  input: {
    poolId: string;
    userId: string;
    kind: "person" | "agent";
    /** The family member's user, for a person. */
    memberUserId: string | null;
    label: string;
    rules: MemberRules;
  },
): Promise<MemberRow> {
  validateRules(input.rules);
  if (input.kind === "person" && !input.memberUserId) {
    throw new DomainError("conflict", "This household has no family member to add.");
  }
  return db.transaction(async (tx) => {
    const pool = await lockOwnedOpenPool(tx, input.poolId, input.userId);
    const [existing] = await tx.query<MemberRow>(
      `${SELECT_MEMBERS} WHERE pool_id = $1 AND kind = $2 ORDER BY position LIMIT 1`,
      [pool.id, input.kind],
    );

    if (existing) {
      if (existing.active) throw new DomainError("conflict", `${existing.label} is already in this pool.`);
      checkLimit(pool, existing, input.rules.limitCents, { raising: true });
      await writeRules(tx, existing.id, input.rules, true);
      await tx.query("UPDATE pool_members SET active = true WHERE id = $1", [existing.id]);
      return loadMember(tx, pool.id, existing.id);
    }

    const available = Math.max(poolAvailable(poolFunds(pool)), 0);
    if (input.rules.limitCents > available) {
      throw new DomainError(
        "invalid",
        `${input.label}'s limit can be at most ${formatUsd(available)}, which is what's left in the pool.`,
      );
    }
    const memberId = newId();
    const [{ next }] = await tx.query<{ next: number }>(
      "SELECT COALESCE(MAX(position) + 1, 0) AS next FROM pool_members WHERE pool_id = $1",
      [pool.id],
    );
    await tx.query(
      `INSERT INTO pool_members (id, pool_id, kind, user_id, label, limit_cents, approval_threshold_cents, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        memberId,
        pool.id,
        input.kind,
        input.kind === "person" ? input.memberUserId : null,
        input.label.trim().slice(0, 40),
        input.rules.limitCents,
        input.rules.approvalThresholdCents,
        next,
      ],
    );
    await writeRules(tx, memberId, input.rules, false);
    return loadMember(tx, pool.id, memberId);
  });
}

async function lockOwnedOpenPool(tx: Queryable, poolId: string, userId: string): Promise<PoolRow> {
  const [pool] = await tx.query<PoolRow>("SELECT * FROM pools WHERE id = $1 FOR UPDATE", [poolId]);
  if (!pool) throw new DomainError("not_found", "That pool doesn't exist.");
  if (pool.owner_user_id !== userId) throw new DomainError("forbidden", "Only the pool owner can change who can spend.");
  if (pool.status !== "active") throw new DomainError("conflict", "This pool isn't open, so its members can't change.");
  return pool;
}

async function loadMember(tx: Queryable, poolId: string, memberId: string): Promise<MemberRow> {
  const [member] = await tx.query<MemberRow>(`${SELECT_MEMBERS} WHERE id = $1 AND pool_id = $2`, [memberId, poolId]);
  if (!member) throw new DomainError("not_found", "That member isn't in this pool.");
  return member;
}

/**
 * A limit can't go below what is already used (architecture 7.1). Raising it
 * is capped by the pool's available balance, so a raise never promises money
 * the pool doesn't have (architecture 7.3).
 */
function checkLimit(pool: PoolRow, member: MemberRow, limitCents: number, options: { raising?: boolean } = {}) {
  const used = member.reserved_cents + member.captured_cents;
  if (limitCents < used) {
    throw new DomainError(
      "invalid",
      `${member.label} has already used ${formatUsd(used)}, so the limit can't be lower than that.`,
    );
  }
  const raising = options.raising || limitCents > member.limit_cents;
  const available = Math.max(poolAvailable(poolFunds(pool)), 0);
  if (raising && limitCents - used > available) {
    const why =
      used > 0
        ? `${formatUsd(used)} already used plus the ${formatUsd(available)} left in the pool`
        : "what's left in the pool";
    throw new DomainError("invalid", `${member.label}'s limit can be at most ${formatUsd(used + available)}, ${why}.`);
  }
}

async function writeRules(tx: Queryable, memberId: string, rules: MemberRules, replaceStores: boolean) {
  await tx.query("UPDATE pool_members SET limit_cents = $2, approval_threshold_cents = $3 WHERE id = $1", [
    memberId,
    rules.limitCents,
    rules.approvalThresholdCents,
  ]);
  if (replaceStores) await tx.query("DELETE FROM member_stores WHERE member_id = $1", [memberId]);
  await tx.query(
    `INSERT INTO member_stores (member_id, store_name, position)
     SELECT $1, store.name, store.position - 1
     FROM unnest($2::text[]) WITH ORDINALITY AS store(name, position)`,
    [memberId, rules.allowedStores],
  );
}

function validateRules(rules: MemberRules): void {
  if (!Number.isInteger(rules.limitCents) || rules.limitCents <= 0) {
    throw new DomainError("invalid", "The limit must be more than $0.");
  }
  if (!Number.isInteger(rules.approvalThresholdCents) || rules.approvalThresholdCents < 0) {
    throw new DomainError("invalid", "The approval amount must be $0 or more.");
  }
  const stores = rules.allowedStores;
  if (stores.length === 0 || !stores.every(isStore) || new Set(stores).size !== stores.length) {
    throw new DomainError("invalid", "Choose at least one store.");
  }
}
