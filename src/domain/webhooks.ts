/**
 * PayPal webhook intake (plan step S38, architecture 3 and 8).
 *
 * An event is trusted only after the rail verifies its signature on the raw
 * body. Each event is stored once by its PayPal event ID, so a repeat is a
 * no-op. Changes only ever move a record forward, through the same ledger
 * paths a direct PayPal answer uses (`settleCapture`, `settleRefund`,
 * `finishClose`). An event that contradicts the ledger never repairs it: the
 * purchase is marked `needs_attention` and nothing moves.
 */
import { finishClose } from "./pools";
import type { Database, HeaderSource, PaymentEvent, PaymentRail } from "./ports";
import { settleCapture, settleRefund } from "./purchases";
import { newId, type PoolRow, type PurchaseRow } from "./types";

export type WebhookDeps = { db: Database; rail: PaymentRail };

export type EventStatus = "processed" | "unmatched" | "contradiction";

export type WebhookOutcome =
  /** The signature check failed. Nothing was stored. */
  | { result: "rejected" }
  /** The signature check was unclear. Nothing was stored, so PayPal sends it again. */
  | { result: "retry_later" }
  /** A verified event Kitty doesn't use. */
  | { result: "ignored" }
  /** An event already handled. Nothing changed. */
  | { result: "duplicate"; status: EventStatus }
  | { result: "stored"; status: EventStatus; note: string };

type Applied = { status: EventStatus; note: string };

export async function receiveWebhook(
  deps: WebhookDeps,
  input: { rawBody: string; headers: HeaderSource },
): Promise<WebhookOutcome> {
  const verified = await deps.rail.verifyWebhookSignature(input);
  if (verified.outcome === "failed") return { result: "rejected" };
  if (verified.outcome !== "succeeded") return { result: "retry_later" };
  const event = verified.data.event;
  if (!event) return { result: "ignored" };

  // Stored as unmatched first, so a crash mid-way leaves it to be tried again.
  const [inserted] = await deps.db.query<{ id: string }>(
    `INSERT INTO webhook_events (id, paypal_event_id, event_type, payload, status)
     VALUES ($1, $2, $3, $4::jsonb, 'unmatched')
     ON CONFLICT (paypal_event_id) DO NOTHING RETURNING id`,
    [newId(), event.eventId, event.type, JSON.stringify(event)],
  );
  if (!inserted) {
    const [existing] = await deps.db.query<{ status: EventStatus }>(
      "SELECT status FROM webhook_events WHERE paypal_event_id = $1",
      [event.eventId],
    );
    if (existing.status !== "unmatched") return { result: "duplicate", status: existing.status };
    await deps.db.query("UPDATE webhook_events SET attempts = attempts + 1 WHERE paypal_event_id = $1", [event.eventId]);
  }

  const applied = await applyEvent(deps, event);
  await deps.db.query(
    `UPDATE webhook_events SET status = $2, note = $3,
       processed_at = CASE WHEN $2 = 'unmatched' THEN NULL ELSE now() END
     WHERE paypal_event_id = $1`,
    [event.eventId, applied.status, applied.note],
  );
  return { result: "stored", ...applied };
}

/** Applies one verified event. Exported for the tick, which retries unmatched events (S41b). */
export async function applyEvent(deps: WebhookDeps, event: PaymentEvent): Promise<Applied> {
  switch (event.kind) {
    case "capture_completed":
      return applyCaptureCompleted(deps, event);
    case "capture_declined":
    case "capture_denied":
      return applyCaptureFailed(deps, event);
    case "capture_refunded":
      return applyRefund(deps, event);
    case "authorization_voided":
      return applyVoid(deps, event);
    case "authorization_created":
      return processed("Confirms a pool's PayPal approval. Kitty records it when the owner returns.");
  }
}

const SETTLED = new Set(["captured", "refund_pending", "refunded"]);
const IN_FLIGHT = new Set(["capturing", "capture_unknown"]);

async function applyCaptureCompleted(deps: WebhookDeps, event: PaymentEvent, retried = false): Promise<Applied> {
  const purchase = await findPurchase(deps.db, event);
  if (!purchase) return unmatched("No purchase matches this capture yet.");

  if (SETTLED.has(purchase.status)) {
    if (purchase.capture_id === event.captureId) return processed("Already settled.");
    return contradiction(deps.db, purchase, "PayPal reports a different capture than the ledger has.");
  }
  if (!IN_FLIGHT.has(purchase.status) || !event.captureId) {
    return contradiction(deps.db, purchase, `PayPal reports a completed capture for a purchase in ${purchase.status}.`);
  }

  // Never settle on an amount the event alone reports (architecture 7.2).
  if (event.amountCents !== null && event.amountCents !== purchase.amount_cents) {
    const read = await deps.rail.getCapture({ captureId: event.captureId });
    const agrees =
      read.outcome === "succeeded" && read.data.status === "COMPLETED" && read.data.amountCents === purchase.amount_cents;
    if (!agrees) {
      return contradiction(deps.db, purchase, "PayPal's capture amount differs from the purchase. Funds stay set aside.");
    }
  }

  const settled = await settleCapture(deps.db, purchase.id, {
    outcome: "succeeded",
    data: { captureId: event.captureId },
  });
  if (settled.status === "captured" && settled.capture_id === event.captureId) return processed("Capture settled.");
  // Another path moved the purchase first. Judge the event against where it is now, once.
  return retried
    ? contradiction(deps.db, settled, "The purchase changed while this event was applied.")
    : applyCaptureCompleted(deps, event, true);
}

async function applyCaptureFailed(deps: WebhookDeps, event: PaymentEvent): Promise<Applied> {
  const purchase = await findPurchase(deps.db, event);
  if (!purchase) return unmatched("No purchase matches this capture yet.");
  if (purchase.status === "capture_failed") return processed("Already recorded as failed.");
  if (!IN_FLIGHT.has(purchase.status)) {
    return contradiction(deps.db, purchase, `PayPal reports a failed capture for a purchase in ${purchase.status}.`);
  }
  const code = event.kind === "capture_declined" ? "CAPTURE_DECLINED" : "CAPTURE_DENIED";
  const settled = await settleCapture(deps.db, purchase.id, { outcome: "failed", code, message: code });
  if (settled.status === "capture_failed") return processed("Capture failed. The money was returned to the pool.");
  return contradiction(deps.db, settled, "The purchase settled differently while this event was applied.");
}

async function applyRefund(deps: WebhookDeps, event: PaymentEvent): Promise<Applied> {
  const purchase = await findPurchase(deps.db, event);
  if (!purchase) return unmatched("No purchase matches this refund yet.");
  // A refund can arrive before the capture it refunds (docs/spike/S07.md).
  if (IN_FLIGHT.has(purchase.status)) return unmatched("The refunded capture hasn't settled yet.");
  if (purchase.capture_id && event.captureId && purchase.capture_id !== event.captureId) {
    return contradiction(deps.db, purchase, "PayPal refunded a different capture than the ledger has.");
  }
  if (purchase.status === "refunded") {
    if (!purchase.refund_id || purchase.refund_id === event.refundId) return processed("Already refunded.");
    return contradiction(deps.db, purchase, "PayPal reports a second refund for this purchase.");
  }
  if (purchase.status !== "captured" && purchase.status !== "refund_pending") {
    return contradiction(deps.db, purchase, `PayPal reports a refund for a purchase in ${purchase.status}.`);
  }
  if (event.amountCents !== null && event.amountCents !== purchase.amount_cents) {
    return contradiction(deps.db, purchase, "PayPal refunded part of this purchase. Kitty only refunds whole purchases.");
  }
  if (!event.refundId) return contradiction(deps.db, purchase, "The refund event has no refund ID.");

  const settled = await settleRefund(
    deps.db,
    purchase.id,
    { outcome: "succeeded", data: { refundId: event.refundId } },
    { fromCaptured: true },
  );
  if (settled.status === "refunded") return processed("Refund recorded. It doesn't return money to the pool.");
  return contradiction(deps.db, settled, "The purchase changed while this refund was applied.");
}

async function applyVoid(deps: WebhookDeps, event: PaymentEvent): Promise<Applied> {
  if (!event.authorizationId) return unmatched("The void event names no hold.");
  const [pool] = await deps.db.query<PoolRow>(
    `SELECT * FROM pools WHERE authorization_id = $1
        OR id = (SELECT pool_id FROM authorizations WHERE paypal_authorization_id = $1)
     LIMIT 1`,
    [event.authorizationId],
  );
  if (!pool) return unmatched("No pool matches this hold yet.");

  if (pool.status === "closing") {
    const closed = await finishClose(deps.db, pool.id, Math.max(pool.authorized_cents - pool.captured_cents, 0), null);
    return closed.status === "closed" ? processed("The pool's release is confirmed and it is closed.") : processed("Already closed.");
  }
  if (pool.status !== "active") return processed(`Nothing to do for a pool in ${pool.status}.`);

  // The hold is gone while Kitty still lets people spend. PayPal will refuse
  // every capture as a definite failure, so no money is at risk. The paused
  // state that freezes the pool arrives with S45.
  await deps.db.query("UPDATE pools SET note = $2 WHERE id = $1", [
    pool.id,
    "PayPal reports this pool's hold was released. New payments will fail. Close the pool and start a new one.",
  ]);
  return { status: "contradiction", note: "PayPal voided the hold of an open pool." };
}

/** By the invoice ID Kitty sent on the capture, then by the capture ID. */
async function findPurchase(db: Database, event: PaymentEvent): Promise<PurchaseRow | null> {
  if (event.purchaseId) {
    const [purchase] = await db.query<PurchaseRow>("SELECT * FROM purchases WHERE id = $1", [event.purchaseId]);
    if (purchase) return purchase;
  }
  if (event.captureId) {
    const [purchase] = await db.query<PurchaseRow>("SELECT * FROM purchases WHERE capture_id = $1", [event.captureId]);
    if (purchase) return purchase;
  }
  return null;
}

async function contradiction(db: Database, purchase: PurchaseRow, note: string): Promise<Applied> {
  await db.query("UPDATE purchases SET needs_attention = true, updated_at = now() WHERE id = $1", [purchase.id]);
  return { status: "contradiction", note };
}

function processed(note: string): Applied {
  return { status: "processed", note };
}

function unmatched(note: string): Applied {
  return { status: "unmatched", note };
}
