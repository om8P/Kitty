import { describe, expect, it } from "vitest";
import { closePool } from "./pools";
import type { PaymentEvent } from "./ports";
import { submitPurchase } from "./purchases";
import { createWorld, type World } from "./testing";
import type { PoolRow, PurchaseRow } from "./types";
import { receiveWebhook } from "./webhooks";

// Synthetic events only. The fake rail stands in for PayPal's signature check.
const headers = { get: () => null };
let eventCounter = 0;

function event(kind: PaymentEvent["kind"], fields: Partial<PaymentEvent> = {}): PaymentEvent {
  eventCounter += 1;
  return {
    eventId: `WH-TEST-${eventCounter}`,
    kind,
    type: kind,
    purchaseId: null,
    captureId: null,
    refundId: null,
    authorizationId: null,
    amountCents: null,
    ...fields,
  };
}

function deliver(world: World, sent: PaymentEvent | null) {
  world.rail.nextVerify = { outcome: "succeeded", data: { event: sent } };
  return receiveWebhook({ db: world.db, rail: world.rail }, { rawBody: "{}", headers });
}

async function buy(world: World, priceCents: number) {
  const productId = await world.addProduct({ priceCents });
  return submitPurchase(world.deps, {
    poolId: world.pool.id,
    memberId: world.teen.id,
    productId,
    quantity: 1,
    idempotencyKey: `key-${productId}`,
  });
}

/** A $10 purchase whose capture PayPal didn't confirm, so its funds stay reserved. */
async function unknownCapture(world: World) {
  world.rail.nextCharge = { outcome: "unknown", reason: "timeout" };
  const purchase = await buy(world, 10_00);
  expect(purchase.status).toBe("capture_unknown");
  return purchase;
}

async function reload(world: World, purchaseId: string) {
  const [purchase] = await world.db.query<PurchaseRow>("SELECT * FROM purchases WHERE id = $1", [purchaseId]);
  const [pool] = await world.db.query<PoolRow>("SELECT * FROM pools WHERE id = $1", [world.pool.id]);
  return { purchase, pool };
}

async function storedEvents(world: World) {
  return world.db.query<{ paypal_event_id: string; status: string; attempts: number }>(
    "SELECT paypal_event_id, status, attempts FROM webhook_events ORDER BY received_at",
  );
}

describe("webhook signature", () => {
  it("rejects an unsigned event and stores nothing", async () => {
    const world = await createWorld();
    world.rail.nextVerify = { outcome: "failed", code: "signature_invalid", message: "bad" };
    expect(await receiveWebhook({ db: world.db, rail: world.rail }, { rawBody: "{}", headers })).toEqual({ result: "rejected" });
    expect(await storedEvents(world)).toEqual([]);
  });

  it("asks PayPal to send it again when the check is unclear, and stores nothing", async () => {
    const world = await createWorld();
    world.rail.nextVerify = { outcome: "unknown", reason: "timeout" };
    expect(await receiveWebhook({ db: world.db, rail: world.rail }, { rawBody: "{}", headers })).toEqual({
      result: "retry_later",
    });
    expect(await storedEvents(world)).toEqual([]);
  });

  it("ignores a verified event Kitty doesn't use", async () => {
    const world = await createWorld();
    expect(await deliver(world, null)).toEqual({ result: "ignored" });
    expect(await storedEvents(world)).toEqual([]);
  });
});

describe("capture events", () => {
  it("settle an unknown capture once, and a repeat changes nothing", async () => {
    const world = await createWorld();
    const purchase = await unknownCapture(world);
    const completed = event("capture_completed", { purchaseId: purchase.id, captureId: "CAP-WH-1", amountCents: 10_00 });

    expect(await deliver(world, completed)).toMatchObject({ result: "stored", status: "processed" });
    const after = await reload(world, purchase.id);
    expect(after.purchase).toMatchObject({ status: "captured", capture_id: "CAP-WH-1", needs_attention: false });
    expect(after.pool).toMatchObject({ reserved_cents: 0, captured_cents: 10_00 });

    expect(await deliver(world, completed)).toEqual({ result: "duplicate", status: "processed" });
    expect(await reload(world, purchase.id)).toEqual(after);
  });

  it("treat a completed event for a capture already settled as done", async () => {
    const world = await createWorld();
    const purchase = await buy(world, 10_00);
    const sent = event("capture_completed", { purchaseId: purchase.id, captureId: purchase.capture_id, amountCents: 10_00 });
    expect(await deliver(world, sent)).toMatchObject({ status: "processed" });
    expect((await reload(world, purchase.id)).purchase.needs_attention).toBe(false);
  });

  it("flag a different capture for a settled purchase and move no money", async () => {
    const world = await createWorld();
    const purchase = await buy(world, 10_00);
    const before = await reload(world, purchase.id);
    const sent = event("capture_completed", { purchaseId: purchase.id, captureId: "CAP-OTHER", amountCents: 10_00 });

    expect(await deliver(world, sent)).toMatchObject({ status: "contradiction" });
    const after = await reload(world, purchase.id);
    expect(after.purchase).toMatchObject({ status: "captured", capture_id: purchase.capture_id, needs_attention: true });
    expect(after.pool).toEqual(before.pool);
  });

  it("don't settle on an amount the event alone reports", async () => {
    const world = await createWorld();
    const purchase = await unknownCapture(world);
    const sent = event("capture_completed", { purchaseId: purchase.id, captureId: "CAP-ODD", amountCents: 99_00 });

    expect(await deliver(world, sent)).toMatchObject({ status: "contradiction" });
    const after = await reload(world, purchase.id);
    expect(after.purchase).toMatchObject({ status: "capture_unknown", needs_attention: true });
    expect(after.pool.reserved_cents).toBe(10_00);
  });

  it("settle when PayPal's own record of the capture has the purchase's amount", async () => {
    const world = await createWorld();
    const purchase = await unknownCapture(world);
    world.rail.captures.set("CAP-READ", { status: "COMPLETED", amountCents: 10_00, purchaseId: purchase.id });
    const sent = event("capture_completed", { purchaseId: purchase.id, captureId: "CAP-READ", amountCents: 11_50 });

    expect(await deliver(world, sent)).toMatchObject({ status: "processed" });
    expect((await reload(world, purchase.id)).pool).toMatchObject({ reserved_cents: 0, captured_cents: 10_00 });
  });

  it.each(["capture_declined", "capture_denied"] as const)("%s returns reserved funds once", async (kind) => {
    const world = await createWorld();
    const purchase = await unknownCapture(world);
    const sent = event(kind, { purchaseId: purchase.id, captureId: "CAP-NO" });

    expect(await deliver(world, sent)).toMatchObject({ status: "processed" });
    const after = await reload(world, purchase.id);
    expect(after.purchase.status).toBe("capture_failed");
    expect(after.pool).toMatchObject({ reserved_cents: 0, captured_cents: 0 });
    expect(await deliver(world, sent)).toEqual({ result: "duplicate", status: "processed" });
  });

  it("flag a failure event for a purchase already captured", async () => {
    const world = await createWorld();
    const purchase = await buy(world, 10_00);
    expect(await deliver(world, event("capture_denied", { purchaseId: purchase.id }))).toMatchObject({
      status: "contradiction",
    });
    const after = await reload(world, purchase.id);
    expect(after.purchase).toMatchObject({ status: "captured", needs_attention: true });
    expect(after.pool.captured_cents).toBe(10_00);
  });

  it("store an event for a purchase Kitty doesn't know as unmatched", async () => {
    const world = await createWorld();
    const sent = event("capture_completed", { purchaseId: "no-such-purchase", captureId: "CAP-X", amountCents: 1_00 });
    expect(await deliver(world, sent)).toMatchObject({ status: "unmatched" });
    expect(await storedEvents(world)).toEqual([{ paypal_event_id: sent.eventId, status: "unmatched", attempts: 1 }]);
  });
});

describe("refund events", () => {
  it("wait for the capture when they arrive first, then apply on the next delivery", async () => {
    const world = await createWorld();
    const purchase = await unknownCapture(world);
    const refund = event("capture_refunded", {
      purchaseId: purchase.id,
      captureId: "CAP-LATE",
      refundId: "REF-1",
      amountCents: 10_00,
    });

    expect(await deliver(world, refund)).toMatchObject({ status: "unmatched" });
    await deliver(world, event("capture_completed", { purchaseId: purchase.id, captureId: "CAP-LATE", amountCents: 10_00 }));
    expect(await deliver(world, refund)).toMatchObject({ result: "stored", status: "processed" });

    const after = await reload(world, purchase.id);
    expect(after.purchase).toMatchObject({ status: "refunded", refund_id: "REF-1" });
    // Refunds never make money spendable (architecture 7.3).
    expect(after.pool).toMatchObject({ captured_cents: 10_00, refunded_cents: 10_00, reserved_cents: 0 });
    const stored = await storedEvents(world);
    expect(stored.find((row) => row.paypal_event_id === refund.eventId)).toMatchObject({ status: "processed", attempts: 2 });

    expect(await deliver(world, refund)).toEqual({ result: "duplicate", status: "processed" });
  });

  it("confirm a refund the owner started", async () => {
    const world = await createWorld();
    const purchase = await buy(world, 10_00);
    await world.db.query("UPDATE purchases SET status = 'refund_pending' WHERE id = $1", [purchase.id]);
    const sent = event("capture_refunded", {
      purchaseId: purchase.id,
      captureId: purchase.capture_id,
      refundId: "REF-2",
      amountCents: 10_00,
    });
    expect(await deliver(world, sent)).toMatchObject({ status: "processed" });
    expect((await reload(world, purchase.id)).purchase).toMatchObject({ status: "refunded", refund_id: "REF-2" });
  });

  it("flag a partial refund and leave the purchase captured", async () => {
    const world = await createWorld();
    const purchase = await buy(world, 10_00);
    const sent = event("capture_refunded", {
      purchaseId: purchase.id,
      captureId: purchase.capture_id,
      refundId: "REF-3",
      amountCents: 4_00,
    });
    expect(await deliver(world, sent)).toMatchObject({ status: "contradiction" });
    const after = await reload(world, purchase.id);
    expect(after.purchase).toMatchObject({ status: "captured", needs_attention: true });
    expect(after.pool.refunded_cents).toBe(0);
  });
});

describe("void events", () => {
  it("finish closing a pool whose release PayPal hadn't confirmed", async () => {
    const world = await createWorld();
    await buy(world, 10_00);
    world.rail.nextRelease = { outcome: "unknown", reason: "timeout" };
    const closing = await closePool({ db: world.db, rail: world.rail }, { poolId: world.pool.id, userId: world.owner.id });
    expect(closing.status).toBe("closing");

    const voided = event("authorization_voided", { authorizationId: closing.authorization_id });
    expect(await deliver(world, voided)).toMatchObject({ status: "processed" });
    const [pool] = await world.db.query<PoolRow>("SELECT * FROM pools WHERE id = $1", [world.pool.id]);
    expect(pool).toMatchObject({ status: "closed", released_cents: 140_00, captured_cents: 10_00 });

    expect(await deliver(world, event("authorization_voided", { authorizationId: closing.authorization_id }))).toMatchObject({
      status: "processed",
    });
    const [again] = await world.db.query<PoolRow>("SELECT * FROM pools WHERE id = $1", [world.pool.id]);
    expect(again.released_cents).toBe(140_00);
  });

  it("flag a void of an open pool's hold without changing its money", async () => {
    const world = await createWorld();
    const sent = event("authorization_voided", { authorizationId: world.pool.authorization_id });
    expect(await deliver(world, sent)).toMatchObject({ status: "contradiction" });
    const [pool] = await world.db.query<PoolRow>("SELECT * FROM pools WHERE id = $1", [world.pool.id]);
    expect(pool).toMatchObject({ status: "active", released_cents: 0 });
    expect(pool.note).toContain("hold was released");
  });
});
