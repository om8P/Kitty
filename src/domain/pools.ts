/**
 * Pool lifecycle: create and approve (architecture 5.1), close and release
 * (5.6), and the read model the screens poll.
 */
import type { Database, PaymentRail } from "./ports";
import { poolAvailable } from "./rules";
import { isStore, SELECT_MEMBERS } from "./stores";
import {
  DomainError,
  newId,
  poolFunds,
  type AgentRunRow,
  type MemberRow,
  type PoolRow,
  type PurchaseRow,
  type UserRow,
} from "./types";

export type PoolDeps = { db: Database; rail: PaymentRail; now?: () => Date };

export const MAX_POOL_CENTS = 500_00;
export const MIN_POOL_CENTS = 5_00;
export const MAX_TERM_DAYS = 28;
/** PayPal honors an authorization for 29 days. Used when PayPal's response gives no expiry. */
const HOLD_DAYS = 29;
/** A capture is honored for the first 3 days of the 29, so the honor period ends 26 days before expiry (arch 5.1). */
const DAYS_AFTER_HONOR = 26;

export type NewMember = {
  kind: "person" | "agent";
  userId: string | null;
  label: string;
  limitCents: number;
  approvalThresholdCents: number;
  allowedStores: string[];
};

export type NewPool = {
  householdId: string;
  ownerUserId: string;
  goal: string;
  amountCents: number;
  termDays: number;
  members: NewMember[];
};

/** Creates the pool and its PayPal order, and returns where to send the owner to approve it. */
export async function createPool(
  deps: PoolDeps,
  input: NewPool,
  urls: { returnUrl: string; cancelUrl: string },
): Promise<{ pool: PoolRow; approvalUrl: string }> {
  const { db, rail } = deps;
  const now = (deps.now ?? (() => new Date()))();
  validateNewPool(input);
  if (rail.name === "unconfigured") {
    throw new DomainError("conflict", "PayPal isn't set up, so no pool was created. Nothing was held.");
  }

  const poolId = newId();
  const endsAt = new Date(now.getTime() + input.termDays * 86_400_000);
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO pools (id, household_id, owner_user_id, goal, status, term_days, ends_at, rail, requested_cents)
       VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7, $8)`,
      [poolId, input.householdId, input.ownerUserId, input.goal.trim(), input.termDays, endsAt, rail.name, input.amountCents],
    );
    for (const [position, member] of input.members.entries()) {
      const memberId = newId();
      await tx.query(
        `INSERT INTO pool_members
           (id, pool_id, kind, user_id, label, limit_cents, approval_threshold_cents, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          memberId,
          poolId,
          member.kind,
          member.userId,
          member.label.trim(),
          member.limitCents,
          member.approvalThresholdCents,
          position,
        ],
      );
      await tx.query(
        `INSERT INTO member_stores (member_id, store_name, position)
         SELECT $1, store.name, store.position - 1
         FROM unnest($2::text[]) WITH ORDINALITY AS store(name, position)`,
        [memberId, member.allowedStores],
      );
    }
  });

  const payment = await rail.createPoolPayment({
    poolId,
    amountCents: input.amountCents,
    returnUrl: urls.returnUrl,
    cancelUrl: urls.cancelUrl,
  });
  if (payment.outcome !== "succeeded") {
    await db.query("UPDATE pools SET status = 'abandoned', note = $2 WHERE id = $1", [
      poolId,
      "PayPal could not start the approval.",
    ]);
    throw new DomainError("conflict", "PayPal could not start the approval. Nothing was held. Try again in a moment.");
  }

  const [pool] = await db.query<PoolRow>(
    "UPDATE pools SET status = 'awaiting_payer', paypal_order_id = $2 WHERE id = $1 RETURNING *",
    [poolId, payment.data.orderId],
  );
  return { pool, approvalUrl: payment.data.approvalUrl };
}

/** The owner came back from PayPal. Authorizes the order and opens the pool. Safe to call twice. */
export async function confirmPool(deps: PoolDeps, input: { orderId: string; householdId: string }): Promise<PoolRow> {
  const { db, rail } = deps;
  const now = (deps.now ?? (() => new Date()))();

  const [pool] = await db.query<PoolRow>("SELECT * FROM pools WHERE paypal_order_id = $1", [input.orderId]);
  if (!pool || pool.household_id !== input.householdId) {
    throw new DomainError("not_found", "We couldn't find a pool for that PayPal approval.");
  }
  if (pool.status !== "awaiting_payer") return pool;

  const result = await rail.confirmPoolPayment({ poolId: pool.id, orderId: input.orderId });
  if (result.outcome !== "succeeded") {
    throw new DomainError(
      "conflict",
      "PayPal hasn't confirmed the approval yet. Nothing has been spent. Reload this page to check again.",
    );
  }

  const authorizedCents = result.data.authorizedCents ?? pool.requested_cents;
  const expiresAt = result.data.expiresAt ?? new Date(now.getTime() + HOLD_DAYS * 86_400_000);
  const honorEndsAt = new Date(expiresAt.getTime() - DAYS_AFTER_HONOR * 86_400_000);
  return db.transaction(async (tx) => {
    const [locked] = await tx.query<PoolRow>("SELECT * FROM pools WHERE id = $1 FOR UPDATE", [pool.id]);
    if (locked.status !== "awaiting_payer") return locked;
    await tx.query(
      "INSERT INTO ledger_entries (id, pool_id, kind, amount_cents) VALUES ($1, $2, 'authorize', $3)",
      [newId(), pool.id, authorizedCents],
    );
    // The same id the N2 backfill gave existing pools, so each pool's first hold has one row.
    await tx.query(
      `INSERT INTO authorizations (id, pool_id, paypal_authorization_id, amount_cents, honor_ends_at, expires_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active')`,
      [`auth_${pool.id}`, pool.id, result.data.authorizationId, authorizedCents, honorEndsAt, expiresAt],
    );
    const [active] = await tx.query<PoolRow>(
      `UPDATE pools SET status = 'active', authorization_id = $2, authorized_cents = $3, hold_expires_at = $4
       WHERE id = $1 RETURNING *`,
      [pool.id, result.data.authorizationId, authorizedCents, expiresAt],
    );
    return active;
  });
}

export async function abandonPool(db: Database, input: { orderId: string; householdId: string }): Promise<void> {
  await db.query(
    `UPDATE pools SET status = 'abandoned', note = 'The PayPal approval was cancelled.'
     WHERE paypal_order_id = $1 AND household_id = $2 AND status = 'awaiting_payer'`,
    [input.orderId, input.householdId],
  );
}

/**
 * Closes the pool and releases what was never spent by voiding the PayPal
 * hold. Calling it again on a pool stuck in `closing` retries the release.
 */
export async function closePool(deps: PoolDeps, input: { poolId: string; userId: string }): Promise<PoolRow> {
  const { db, rail } = deps;

  const closing = await db.transaction(async (tx) => {
    const [pool] = await tx.query<PoolRow>("SELECT * FROM pools WHERE id = $1 FOR UPDATE", [input.poolId]);
    if (!pool) throw new DomainError("not_found", "That pool doesn't exist.");
    if (pool.owner_user_id !== input.userId) throw new DomainError("forbidden", "Only the pool owner can close it.");
    if (pool.status !== "active" && pool.status !== "closing") {
      throw new DomainError("conflict", "This pool is already closed.");
    }
    const inFlight = await tx.query(
      "SELECT 1 FROM purchases WHERE pool_id = $1 AND status IN ('capturing', 'capture_unknown') LIMIT 1",
      [pool.id],
    );
    if (inFlight.length > 0) {
      throw new DomainError("conflict", "A payment is still settling. Wait for it to finish, then close the pool.");
    }
    // From here no new money can be reserved, and waiting requests can't be approved.
    await tx.query(
      `UPDATE purchases SET status = 'expired', message = 'The pool closed before this was decided.', updated_at = now()
       WHERE pool_id = $1 AND status IN ('awaiting_approval', 'reviewing')`,
      [pool.id],
    );
    const [updated] = await tx.query<PoolRow>("UPDATE pools SET status = 'closing' WHERE id = $1 RETURNING *", [pool.id]);
    return updated;
  });

  const leftover = closing.authorized_cents - closing.captured_cents;
  if (leftover <= 0 || !closing.authorization_id) {
    return finishClose(db, closing.id, 0, null);
  }

  const result = await rail.releaseHold({ authorizationId: closing.authorization_id });
  if (result.outcome === "succeeded") return finishClose(db, closing.id, leftover, null);
  if (result.outcome === "unknown") {
    const [stuck] = await db.query<PoolRow>(
      "UPDATE pools SET note = $2 WHERE id = $1 RETURNING *",
      [closing.id, "PayPal has not confirmed the release yet. Close the pool again to retry."],
    );
    return stuck;
  }
  // PayPal refused the void. Spending is still closed, and the hold lapses on its own.
  return finishClose(
    db,
    closing.id,
    0,
    "PayPal could not release the hold early. It expires on its own and nothing more can be spent.",
  );
}

async function finishClose(db: Database, poolId: string, releasedCents: number, note: string | null): Promise<PoolRow> {
  return db.transaction(async (tx) => {
    const [pool] = await tx.query<PoolRow>("SELECT * FROM pools WHERE id = $1 FOR UPDATE", [poolId]);
    if (pool.status !== "closing") return pool;
    if (releasedCents > 0) {
      await tx.query("INSERT INTO ledger_entries (id, pool_id, kind, amount_cents) VALUES ($1, $2, 'void', $3)", [
        newId(),
        poolId,
        releasedCents,
      ]);
      await tx.query(
        "UPDATE authorizations SET status = 'voided' WHERE pool_id = $1 AND paypal_authorization_id = $2 AND status = 'active'",
        [poolId, pool.authorization_id],
      );
    }
    const [closed] = await tx.query<PoolRow>(
      "UPDATE pools SET status = 'closed', released_cents = $2, note = $3, closed_at = now() WHERE id = $1 RETURNING *",
      [poolId, releasedCents, note],
    );
    return closed;
  });
}

export type PoolState = {
  pool: PoolRow;
  availableCents: number;
  members: MemberRow[];
  purchases: PurchaseRow[];
  runs: AgentRunRow[];
};

export async function getPoolState(db: Database, poolId: string): Promise<PoolState | null> {
  const [pool] = await db.query<PoolRow>("SELECT * FROM pools WHERE id = $1", [poolId]);
  if (!pool) return null;
  const [members, purchases, runs] = await Promise.all([
    db.query<MemberRow>(`${SELECT_MEMBERS} WHERE pool_id = $1 ORDER BY position`, [poolId]),
    db.query<PurchaseRow>("SELECT * FROM purchases WHERE pool_id = $1 ORDER BY created_at DESC LIMIT 200", [poolId]),
    db.query<AgentRunRow>("SELECT * FROM agent_runs WHERE pool_id = $1 ORDER BY created_at DESC LIMIT 3", [poolId]),
  ]);
  return { pool, availableCents: Math.max(poolAvailable(poolFunds(pool)), 0), members, purchases, runs };
}

export async function listPools(db: Database, householdId: string): Promise<PoolRow[]> {
  return db.query<PoolRow>(
    "SELECT * FROM pools WHERE household_id = $1 AND status NOT IN ('draft', 'abandoned') ORDER BY created_at DESC",
    [householdId],
  );
}

/** A fresh demo household: one owner and one teen. The agent is a pool member, not a user. */
export async function createDemoHousehold(db: Database): Promise<{ householdId: string; owner: UserRow; teen: UserRow }> {
  const householdId = newId();
  const owner: UserRow = { id: newId(), household_id: householdId, name: "Alex", role: "owner" };
  const teen: UserRow = { id: newId(), household_id: householdId, name: "Sam", role: "member" };
  await db.transaction(async (tx) => {
    await tx.query("INSERT INTO households (id) VALUES ($1)", [householdId]);
    for (const user of [owner, teen]) {
      await tx.query("INSERT INTO users (id, household_id, name, role) VALUES ($1, $2, $3, $4)", [
        user.id,
        user.household_id,
        user.name,
        user.role,
      ]);
    }
  });
  return { householdId, owner, teen };
}

function validateNewPool(input: NewPool): void {
  const goal = input.goal.trim();
  if (goal.length < 3 || goal.length > 120) {
    throw new DomainError("invalid", "Describe the pool's goal in 3 to 120 characters.");
  }
  if (!Number.isInteger(input.amountCents) || input.amountCents < MIN_POOL_CENTS || input.amountCents > MAX_POOL_CENTS) {
    throw new DomainError("invalid", "Choose a pool amount from $5 to $500.");
  }
  if (!Number.isInteger(input.termDays) || input.termDays < 1 || input.termDays > MAX_TERM_DAYS) {
    throw new DomainError("invalid", `Choose a term from 1 to ${MAX_TERM_DAYS} days.`);
  }
  if (input.members.length === 0 || input.members.length > 6) {
    throw new DomainError("invalid", "Add 1 to 6 members.");
  }
  for (const member of input.members) {
    const label = member.label.trim();
    if (label.length < 1 || label.length > 40) throw new DomainError("invalid", "Give each member a name.");
    if (!Number.isInteger(member.limitCents) || member.limitCents <= 0 || member.limitCents > input.amountCents) {
      throw new DomainError("invalid", `${label}'s limit must be more than $0 and no more than the pool amount.`);
    }
    if (!Number.isInteger(member.approvalThresholdCents) || member.approvalThresholdCents < 0) {
      throw new DomainError("invalid", `${label}'s approval amount must be $0 or more.`);
    }
    if (member.allowedStores.length === 0 || !member.allowedStores.every(isStore)) {
      throw new DomainError("invalid", `Choose at least one store for ${label}.`);
    }
  }
}
