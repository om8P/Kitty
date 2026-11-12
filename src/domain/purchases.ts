/**
 * The single path for all spending (architecture 5.2).
 *
 * Every change to a pool's funds happens in a short transaction that first
 * locks the pool row, so two purchases can never spend the same money. No
 * transaction is ever held open across an AI or PayPal call.
 */
import type { Database, PaymentRail, Queryable, RailResult, Reviewer } from "./ports";
import { SELECT_MEMBERS } from "./stores";
import { checkHardRules, finalOutcome } from "./rules";
import {
  DomainError,
  memberFunds,
  newId,
  poolFunds,
  type MemberRow,
  type PoolRow,
  type ProductRow,
  type PurchaseRow,
} from "./types";

export type PurchaseDeps = {
  db: Database;
  rail: PaymentRail;
  reviewer: Reviewer;
  now?: () => Date;
};

const MAX_QUANTITY = 20;
/** A purchase waiting for the owner expires after a day (architecture 5.3). */
export const APPROVAL_TTL_MS = 24 * 60 * 60_000;
const EXPIRED_MESSAGE = "Nobody decided within a day, so it expired. Nothing was charged.";

export async function submitPurchase(
  deps: PurchaseDeps,
  input: {
    poolId: string;
    memberId: string;
    productId: string;
    quantity: number;
    /** A repeated call with the same key returns the same purchase. */
    idempotencyKey: string;
    agentRunId?: string;
  },
): Promise<PurchaseRow> {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());

  const [existing] = await db.query<PurchaseRow>("SELECT * FROM purchases WHERE idempotency_key = $1", [
    input.idempotencyKey,
  ]);
  if (existing) return existing;

  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > MAX_QUANTITY) {
    throw new DomainError("invalid", `Choose a quantity from 1 to ${MAX_QUANTITY}.`);
  }
  // The price always comes from our own products row, never from the caller.
  const [product] = await db.query<ProductRow>("SELECT * FROM products WHERE id = $1", [input.productId]);
  if (!product) throw new DomainError("not_found", "That product is no longer available.");
  const amountCents = product.price_cents * input.quantity;

  // Tx A: hard rules, before any AI call.
  const started = await db.transaction(async (tx) => {
    const { pool, member } = await lockPoolAndMember(tx, input.poolId, input.memberId);
    const check = checkHardRules({
      pool: poolFunds(pool),
      member: memberFunds(member),
      store: product.store,
      amountCents,
      now: now(),
    });
    const rows = await tx.query<PurchaseRow>(
      `INSERT INTO purchases
         (id, pool_id, member_id, product_id, product_title, store, quantity, amount_cents,
          status, rule_code, message, idempotency_key, agent_run_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING *`,
      [
        newId(),
        pool.id,
        member.id,
        product.id,
        product.title.slice(0, 200),
        product.store,
        input.quantity,
        amountCents,
        check.ok ? "reviewing" : "rejected_by_rules",
        check.ok ? null : check.code,
        check.ok ? null : check.message,
        input.idempotencyKey,
        input.agentRunId ?? null,
      ],
    );
    return { purchase: rows[0], pool, member, needsApproval: check.ok && check.needsApproval };
  });

  if (!started.purchase) {
    // A concurrent call with the same key won the insert.
    const [winner] = await db.query<PurchaseRow>("SELECT * FROM purchases WHERE idempotency_key = $1", [
      input.idempotencyKey,
    ]);
    return winner;
  }
  if (started.purchase.status !== "reviewing") return started.purchase;

  // AI review, outside any transaction. The reviewer never throws.
  const review = await deps.reviewer.review({
    poolGoal: started.pool.goal,
    memberLabel: started.member.label,
    memberKind: started.member.kind,
    store: product.store,
    quantity: input.quantity,
    amountCents,
    productTitle: product.title,
    productDescription: product.description,
  });

  const outcome = finalOutcome(started.needsApproval, review.decision);
  const purchaseId = started.purchase.id;

  if (outcome === "blocked") {
    return updateReviewed(db, purchaseId, "blocked_by_ai", review, null, "The AI check blocked this purchase.", null);
  }
  if (outcome === "needs_approval") {
    const reason =
      review.decision === "flag"
        ? "The AI check flagged it"
        : review.decision === "unavailable"
          ? "AI review unavailable"
          : "Over this member's approval amount";
    const expiresAt = new Date(now().getTime() + APPROVAL_TTL_MS);
    return updateReviewed(db, purchaseId, "awaiting_approval", review, reason, null, expiresAt);
  }

  await db.query(
    "UPDATE purchases SET ai_decision = $2, ai_reason = $3, updated_at = now() WHERE id = $1 AND status = 'reviewing'",
    [purchaseId, review.decision, review.reason],
  );
  return reserveAndCapture(deps, purchaseId, "reviewing");
}

/** Owner approves a waiting purchase. Every hard rule is re-run against current state. */
export async function approvePurchase(deps: PurchaseDeps, input: { purchaseId: string; userId: string }) {
  const purchase = await loadOwnedPurchase(deps.db, input.purchaseId, input.userId);
  if (purchase.status !== "awaiting_approval") {
    throw new DomainError("conflict", "This purchase is no longer waiting for approval.");
  }
  // A request past its expiry expires now, even if the tick hasn't run yet.
  const now = (deps.now ?? (() => new Date()))();
  const [expired] = await deps.db.query<PurchaseRow>(
    `UPDATE purchases SET status = 'expired', message = $3, updated_at = now()
     WHERE id = $1 AND status = 'awaiting_approval'
       AND COALESCE(approval_expires_at, updated_at + interval '24 hours') <= $2
     RETURNING *`,
    [purchase.id, now, EXPIRED_MESSAGE],
  );
  if (expired) throw new DomainError("conflict", "This request expired before it was approved. Nothing was charged.");
  return reserveAndCapture(deps, purchase.id, "awaiting_approval", input.userId);
}

/**
 * Expires every waiting request past its expiry. Requests made before expiries
 * were recorded expire a day after their last change. Returns how many expired.
 */
export async function expireWaitingApprovals(db: Database, now: Date): Promise<number> {
  const expired = await db.query<{ id: string }>(
    `UPDATE purchases SET status = 'expired', message = $2, updated_at = now()
     WHERE status = 'awaiting_approval'
       AND COALESCE(approval_expires_at, updated_at + interval '24 hours') <= $1
     RETURNING id`,
    [now, EXPIRED_MESSAGE],
  );
  return expired.length;
}

export async function denyPurchase(deps: PurchaseDeps, input: { purchaseId: string; userId: string }) {
  const purchase = await loadOwnedPurchase(deps.db, input.purchaseId, input.userId);
  const [denied] = await deps.db.query<PurchaseRow>(
    `UPDATE purchases SET status = 'denied', message = 'Denied by the owner.', decided_by = $2, updated_at = now()
     WHERE id = $1 AND status = 'awaiting_approval' RETURNING *`,
    [purchase.id, input.userId],
  );
  if (!denied) throw new DomainError("conflict", "This purchase is no longer waiting for approval.");
  return denied;
}

/**
 * Replays a capture whose outcome was unclear. It reuses the same PayPal
 * request ID, so it can never charge twice.
 */
export async function recheckCapture(deps: PurchaseDeps, input: { purchaseId: string; userId: string }) {
  const purchase = await loadOwnedPurchase(deps.db, input.purchaseId, input.userId);
  if (purchase.status !== "capture_unknown" && purchase.status !== "capturing") {
    throw new DomainError("conflict", "This purchase has already settled.");
  }
  return replayCapture(deps, purchase);
}

/**
 * Sends the same capture again: same authorization, amount and request ID, so
 * PayPal returns the original result and never charges twice (architecture
 * 7.2). The owner's re-check and the tick both use it.
 */
export async function replayCapture(deps: PurchaseDeps, purchase: PurchaseRow): Promise<PurchaseRow> {
  if (!purchase.authorization_id) throw new DomainError("conflict", "This purchase has no hold to capture from.");
  const result = await deps.rail.charge({
    purchaseId: purchase.id,
    authorizationId: purchase.authorization_id,
    amountCents: purchase.amount_cents,
  });
  return settleCapture(deps.db, purchase.id, result);
}

/** Refunds a whole captured purchase. The money goes back to the payer, not back into the pool (architecture 7.3). */
export async function refundPurchase(deps: PurchaseDeps, input: { purchaseId: string; userId: string }) {
  const { db, rail } = deps;
  const owned = await loadOwnedPurchase(db, input.purchaseId, input.userId);

  const pending = await db.transaction(async (tx) => {
    await lockPool(tx, owned.pool_id);
    const [purchase] = await tx.query<PurchaseRow>("SELECT * FROM purchases WHERE id = $1 FOR UPDATE", [owned.id]);
    if (purchase.status !== "captured" && purchase.status !== "refund_pending") {
      throw new DomainError("conflict", "Only a captured purchase can be refunded.");
    }
    if (!purchase.capture_id) throw new DomainError("conflict", "This purchase has no capture to refund.");
    const [updated] = await tx.query<PurchaseRow>(
      "UPDATE purchases SET status = 'refund_pending', updated_at = now() WHERE id = $1 RETURNING *",
      [purchase.id],
    );
    return updated;
  });

  const result = await rail.refund({ purchaseId: pending.id, captureId: pending.capture_id as string });
  return settleRefund(db, pending.id, result);
}

/**
 * Records a refund's outcome under the pool lock. A refund sends money back to
 * the payer and never makes it spendable (architecture 7.3). A webhook may
 * also confirm a refund made outside Kitty, so `captured` is accepted when
 * `fromCaptured` is set, for a definite success only.
 */
export async function settleRefund(
  db: Database,
  purchaseId: string,
  result: RailResult<{ refundId: string }>,
  options: { fromCaptured?: boolean } = {},
): Promise<PurchaseRow> {
  return db.transaction(async (tx) => {
    const [unlocked] = await tx.query<PurchaseRow>("SELECT * FROM purchases WHERE id = $1", [purchaseId]);
    if (!unlocked) throw new DomainError("not_found", "That purchase doesn't exist.");
    await lockPool(tx, unlocked.pool_id);
    const [purchase] = await tx.query<PurchaseRow>("SELECT * FROM purchases WHERE id = $1 FOR UPDATE", [purchaseId]);
    const fromCaptured = options.fromCaptured && result.outcome === "succeeded" && purchase.status === "captured";
    if (purchase.status !== "refund_pending" && !fromCaptured) return purchase;

    if (result.outcome === "succeeded") {
      await tx.query("UPDATE pools SET refunded_cents = refunded_cents + $2 WHERE id = $1", [
        purchase.pool_id,
        purchase.amount_cents,
      ]);
      await addLedgerEntry(tx, purchase, "refund");
      const [refunded] = await tx.query<PurchaseRow>(
        `UPDATE purchases SET status = 'refunded', refund_id = $2,
           message = 'Refunded to the payer. The limit stays used.', updated_at = now()
         WHERE id = $1 RETURNING *`,
        [purchase.id, result.data.refundId],
      );
      return refunded;
    }
    if (result.outcome === "unknown") {
      const [unknown] = await tx.query<PurchaseRow>(
        `UPDATE purchases SET message = 'PayPal has not confirmed the refund yet. Check again in a moment.',
           updated_at = now() WHERE id = $1 RETURNING *`,
        [purchase.id],
      );
      return unknown;
    }
    const [restored] = await tx.query<PurchaseRow>(
      "UPDATE purchases SET status = 'captured', message = $2, updated_at = now() WHERE id = $1 RETURNING *",
      [purchase.id, `PayPal could not refund this purchase (${result.code}).`],
    );
    return restored;
  });
}

/** Tx B then capture then Tx C. `from` is the status the purchase must still be in. */
async function reserveAndCapture(
  deps: PurchaseDeps,
  purchaseId: string,
  from: "reviewing" | "awaiting_approval",
  /** The owner who approved it, when `from` is `awaiting_approval`. */
  decidedBy: string | null = null,
): Promise<PurchaseRow> {
  const { db, rail } = deps;
  const now = deps.now ?? (() => new Date());

  const reserved = await db.transaction(async (tx) => {
    const [unlocked] = await tx.query<PurchaseRow>("SELECT * FROM purchases WHERE id = $1", [purchaseId]);
    if (!unlocked) throw new DomainError("not_found", "That purchase doesn't exist.");
    const { pool, member } = await lockPoolAndMember(tx, unlocked.pool_id, unlocked.member_id);
    const [purchase] = await tx.query<PurchaseRow>("SELECT * FROM purchases WHERE id = $1 FOR UPDATE", [purchaseId]);
    if (purchase.status !== from) return { purchase, capture: false as const };

    // Balances may have changed during review or while waiting for approval.
    const check = checkHardRules({
      pool: poolFunds(pool),
      member: memberFunds(member),
      store: purchase.store,
      amountCents: purchase.amount_cents,
      now: now(),
    });
    if (!check.ok) {
      const [rejected] = await tx.query<PurchaseRow>(
        `UPDATE purchases SET status = 'rejected_by_rules', rule_code = $2, message = $3,
           decided_by = COALESCE($4, decided_by), updated_at = now()
         WHERE id = $1 RETURNING *`,
        [purchase.id, check.code, check.message, decidedBy],
      );
      return { purchase: rejected, capture: false as const };
    }
    if (!pool.authorization_id) throw new DomainError("conflict", "This pool has no PayPal hold.");

    await tx.query("UPDATE pools SET reserved_cents = reserved_cents + $2 WHERE id = $1", [
      pool.id,
      purchase.amount_cents,
    ]);
    await tx.query("UPDATE pool_members SET reserved_cents = reserved_cents + $2 WHERE id = $1", [
      member.id,
      purchase.amount_cents,
    ]);
    await addLedgerEntry(tx, purchase, "reserve");
    const [capturing] = await tx.query<PurchaseRow>(
      `UPDATE purchases SET status = 'capturing', authorization_id = $2, decided_by = COALESCE($3, decided_by),
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [purchase.id, pool.authorization_id, decidedBy],
    );
    return { purchase: capturing, capture: true as const };
  });

  if (!reserved.capture) return reserved.purchase;

  const result = await rail.charge({
    purchaseId: reserved.purchase.id,
    authorizationId: reserved.purchase.authorization_id as string,
    amountCents: reserved.purchase.amount_cents,
  });
  return settleCapture(db, reserved.purchase.id, result);
}

/**
 * Tx C. The ledger settles with the purchase's own amount, never the amount in
 * a capture response, because a replayed response can echo the wrong amount
 * (docs/spike/S05.md).
 */
export async function settleCapture(
  db: Database,
  purchaseId: string,
  result: RailResult<{ captureId: string }>,
): Promise<PurchaseRow> {
  return db.transaction(async (tx) => {
    const [unlocked] = await tx.query<PurchaseRow>("SELECT * FROM purchases WHERE id = $1", [purchaseId]);
    await lockPool(tx, unlocked.pool_id);
    const [purchase] = await tx.query<PurchaseRow>("SELECT * FROM purchases WHERE id = $1 FOR UPDATE", [purchaseId]);
    if (purchase.status !== "capturing" && purchase.status !== "capture_unknown") return purchase;

    if (result.outcome === "succeeded") {
      await tx.query(
        "UPDATE pools SET reserved_cents = reserved_cents - $2, captured_cents = captured_cents + $2 WHERE id = $1",
        [purchase.pool_id, purchase.amount_cents],
      );
      await tx.query(
        `UPDATE pool_members SET reserved_cents = reserved_cents - $2, captured_cents = captured_cents + $2
         WHERE id = $1`,
        [purchase.member_id, purchase.amount_cents],
      );
      await addLedgerEntry(tx, purchase, "capture");
      const [captured] = await tx.query<PurchaseRow>(
        "UPDATE purchases SET status = 'captured', capture_id = $2, message = NULL, updated_at = now() WHERE id = $1 RETURNING *",
        [purchase.id, result.data.captureId],
      );
      return captured;
    }

    if (result.outcome === "unknown") {
      // Funds stay reserved until PayPal gives a clear answer.
      const [unknown] = await tx.query<PurchaseRow>(
        `UPDATE purchases SET status = 'capture_unknown',
           message = 'PayPal has not confirmed this payment yet. The money stays set aside.', updated_at = now()
         WHERE id = $1 RETURNING *`,
        [purchase.id],
      );
      return unknown;
    }

    // A definite failure is the only thing that returns reserved funds.
    await tx.query("UPDATE pools SET reserved_cents = reserved_cents - $2 WHERE id = $1", [
      purchase.pool_id,
      purchase.amount_cents,
    ]);
    await tx.query("UPDATE pool_members SET reserved_cents = reserved_cents - $2 WHERE id = $1", [
      purchase.member_id,
      purchase.amount_cents,
    ]);
    await addLedgerEntry(tx, purchase, "release");
    const [failed] = await tx.query<PurchaseRow>(
      "UPDATE purchases SET status = 'capture_failed', message = $2, updated_at = now() WHERE id = $1 RETURNING *",
      [purchase.id, `PayPal declined the payment (${result.code}). Nothing was charged.`],
    );
    return failed;
  });
}

async function updateReviewed(
  db: Database,
  purchaseId: string,
  status: "blocked_by_ai" | "awaiting_approval",
  review: { decision: string; reason: string },
  approvalReason: string | null,
  message: string | null,
  approvalExpiresAt: Date | null,
): Promise<PurchaseRow> {
  const [updated] = await db.query<PurchaseRow>(
    `UPDATE purchases SET status = $2, ai_decision = $3, ai_reason = $4, approval_reason = $5, message = $6,
       approval_expires_at = $7, updated_at = now()
     WHERE id = $1 AND status = 'reviewing' RETURNING *`,
    [purchaseId, status, review.decision, review.reason, approvalReason, message, approvalExpiresAt],
  );
  if (updated) return updated;
  const [current] = await db.query<PurchaseRow>("SELECT * FROM purchases WHERE id = $1", [purchaseId]);
  return current;
}

async function lockPool(tx: Queryable, poolId: string): Promise<PoolRow> {
  const [pool] = await tx.query<PoolRow>("SELECT * FROM pools WHERE id = $1 FOR UPDATE", [poolId]);
  if (!pool) throw new DomainError("not_found", "That pool doesn't exist.");
  return pool;
}

async function lockPoolAndMember(tx: Queryable, poolId: string, memberId: string) {
  const pool = await lockPool(tx, poolId);
  // Member counters change only under the pool lock, so one lock is enough.
  const [member] = await tx.query<MemberRow>(`${SELECT_MEMBERS} WHERE id = $1 AND pool_id = $2`, [
    memberId,
    poolId,
  ]);
  if (!member) throw new DomainError("forbidden", "You aren't a member of this pool.");
  return { pool, member };
}

async function loadOwnedPurchase(db: Database, purchaseId: string, userId: string): Promise<PurchaseRow> {
  const [purchase] = await db.query<PurchaseRow>("SELECT * FROM purchases WHERE id = $1", [purchaseId]);
  if (!purchase) throw new DomainError("not_found", "That purchase doesn't exist.");
  const [pool] = await db.query<PoolRow>("SELECT * FROM pools WHERE id = $1", [purchase.pool_id]);
  if (!pool || pool.owner_user_id !== userId) {
    throw new DomainError("forbidden", "Only the pool owner can do this.");
  }
  return purchase;
}

async function addLedgerEntry(
  tx: Queryable,
  purchase: PurchaseRow,
  kind: "reserve" | "release" | "capture" | "refund",
) {
  await tx.query(
    "INSERT INTO ledger_entries (id, pool_id, member_id, purchase_id, kind, amount_cents) VALUES ($1, $2, $3, $4, $5, $6)",
    [newId(), purchase.pool_id, purchase.member_id, purchase.id, kind, purchase.amount_cents],
  );
}
