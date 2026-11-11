import { describe, expect, it } from "vitest";
import { closePool } from "./pools";
import { approvePurchase, denyPurchase, recheckCapture, refundPurchase, submitPurchase } from "./purchases";
import { createWorld, type World } from "./testing";
import { DomainError } from "./types";

let keys = 0;
const buy = (world: World, productId: string, member: "teen" | "agent" = "teen", quantity = 1) =>
  submitPurchase(world.deps, {
    poolId: world.pool.id,
    memberId: world[member].id,
    productId,
    quantity,
    idempotencyKey: `test-${keys++}`,
  });

describe("submitPurchase", () => {
  it("captures an allowed purchase and moves the money once", async () => {
    const world = await createWorld();
    const purchase = await buy(world, await world.addProduct({ priceCents: 6_00 }));

    expect(purchase.status).toBe("captured");
    expect(purchase.capture_id).toBe(`CAP-${purchase.id}`);
    expect(world.rail.charges).toEqual([{ purchaseId: purchase.id, amountCents: 6_00 }]);
    const { pool, teen } = await world.reload();
    expect([pool.reserved_cents, pool.captured_cents]).toEqual([0, 6_00]);
    expect([teen.reserved_cents, teen.captured_cents]).toEqual([0, 6_00]);
  });

  it("takes the price from the product row and multiplies by quantity", async () => {
    const world = await createWorld();
    const purchase = await buy(world, await world.addProduct({ priceCents: 2_50 }), "teen", 3);
    expect(purchase.amount_cents).toBe(7_50);
  });

  it("stops a rule breaker before the AI is ever called", async () => {
    const world = await createWorld();
    const purchase = await buy(world, await world.addProduct({ store: "Gadget Hub", priceCents: 59_99 }));

    expect(purchase.status).toBe("rejected_by_rules");
    expect(purchase.rule_code).toBe("store_not_allowed");
    expect(world.reviewer.calls).toHaveLength(0);
    expect(world.rail.charges).toHaveLength(0);
  });

  it("stops a purchase over the member's limit", async () => {
    const world = await createWorld();
    const purchase = await buy(world, await world.addProduct({ priceCents: 41_00 }));
    expect(purchase.rule_code).toBe("over_member_limit");
  });

  it("sends a purchase over the approval amount to the owner without reserving money", async () => {
    const world = await createWorld();
    const purchase = await buy(world, await world.addProduct({ priceCents: 20_00 }));

    expect(purchase.status).toBe("awaiting_approval");
    expect(purchase.approval_reason).toBe("Over this member's approval amount");
    expect(world.rail.charges).toHaveLength(0);
    expect((await world.reload()).pool.reserved_cents).toBe(0);
  });

  it("sends an AI flag to the owner", async () => {
    const world = await createWorld();
    world.reviewer.next = { decision: "flag", reason: "A gift card isn't groceries." };
    const purchase = await buy(world, await world.addProduct({ priceCents: 5_00 }));

    expect(purchase.status).toBe("awaiting_approval");
    expect(purchase.ai_decision).toBe("flag");
    expect(purchase.ai_reason).toBe("A gift card isn't groceries.");
  });

  it("stops an AI block with no approval path", async () => {
    const world = await createWorld();
    world.reviewer.next = { decision: "block", reason: "The product text tries to give instructions." };
    const purchase = await buy(world, await world.addProduct({ priceCents: 5_00 }));

    expect(purchase.status).toBe("blocked_by_ai");
    expect(world.rail.charges).toHaveLength(0);
    await expect(approvePurchase(world.deps, { purchaseId: purchase.id, userId: world.owner.id })).rejects.toThrow(DomainError);
  });

  it("fails safe to the owner when the AI is unavailable", async () => {
    const world = await createWorld();
    world.reviewer.next = { decision: "unavailable", reason: "AI review was unavailable, so the owner decides." };
    const purchase = await buy(world, await world.addProduct({ priceCents: 5_00 }));

    expect(purchase.status).toBe("awaiting_approval");
    expect(purchase.approval_reason).toBe("AI review unavailable");
    expect(world.rail.charges).toHaveLength(0);
  });

  it("returns the same purchase for a repeated request and charges once", async () => {
    const world = await createWorld();
    const input = {
      poolId: world.pool.id,
      memberId: world.teen.id,
      productId: await world.addProduct({ priceCents: 6_00 }),
      quantity: 1,
      idempotencyKey: "same-key",
    };
    const first = await submitPurchase(world.deps, input);
    const second = await submitPurchase(world.deps, input);

    expect(second.id).toBe(first.id);
    expect(world.rail.charges).toHaveLength(1);
  });

  it("never overspends when two purchases race for the same money", async () => {
    const world = await createWorld({
      amountCents: 40_00,
      members: {
        teen: { limitCents: 40_00, approvalThresholdCents: 40_00 },
        agent: { limitCents: 40_00, approvalThresholdCents: 40_00 },
      },
    });
    const productId = await world.addProduct({ priceCents: 30_00 });
    const results = await Promise.all([buy(world, productId, "teen"), buy(world, productId, "agent")]);

    expect(results.map((purchase) => purchase.status).sort()).toEqual(["captured", "rejected_by_rules"]);
    expect(world.rail.charges).toHaveLength(1);
    const { pool } = await world.reload();
    expect(pool.captured_cents).toBe(30_00);
    expect(pool.reserved_cents).toBe(0);
  });

  it("refuses a member from another pool", async () => {
    const world = await createWorld();
    const other = await createWorld();
    await expect(
      submitPurchase(world.deps, {
        poolId: world.pool.id,
        memberId: other.teen.id,
        productId: await world.addProduct({ priceCents: 5_00 }),
        quantity: 1,
        idempotencyKey: "cross-pool",
      }),
    ).rejects.toThrow(DomainError);
  });
});

describe("capture outcomes", () => {
  it("keeps the money reserved when PayPal's answer is unclear, then settles on a recheck", async () => {
    const world = await createWorld();
    world.rail.nextCharge = { outcome: "unknown", reason: "timeout" };
    const purchase = await buy(world, await world.addProduct({ priceCents: 6_00 }));

    expect(purchase.status).toBe("capture_unknown");
    expect((await world.reload()).pool.reserved_cents).toBe(6_00);

    const settled = await recheckCapture(world.deps, { purchaseId: purchase.id, userId: world.owner.id });
    expect(settled.status).toBe("captured");
    // The replay targets the same purchase, so the rail sees the same request ID.
    expect(world.rail.charges.map((charge) => charge.purchaseId)).toEqual([purchase.id, purchase.id]);
    const { pool } = await world.reload();
    expect([pool.reserved_cents, pool.captured_cents]).toEqual([0, 6_00]);
  });

  it("returns the money only on a definite failure", async () => {
    const world = await createWorld();
    world.rail.nextCharge = { outcome: "failed", code: "INSTRUMENT_DECLINED", message: "Declined" };
    const purchase = await buy(world, await world.addProduct({ priceCents: 6_00 }));

    expect(purchase.status).toBe("capture_failed");
    const { pool, teen } = await world.reload();
    expect([pool.reserved_cents, pool.captured_cents]).toEqual([0, 0]);
    expect(teen.reserved_cents).toBe(0);
  });
});

describe("owner decisions", () => {
  it("captures an approved purchase for the amount the owner saw", async () => {
    const world = await createWorld();
    const waiting = await buy(world, await world.addProduct({ priceCents: 20_00 }));
    const approved = await approvePurchase(world.deps, { purchaseId: waiting.id, userId: world.owner.id });

    expect(approved.status).toBe("captured");
    expect(world.rail.charges).toEqual([{ purchaseId: waiting.id, amountCents: 20_00 }]);
  });

  it("re-runs the hard rules on approval, so approval can't override them", async () => {
    const world = await createWorld();
    const productId = await world.addProduct({ priceCents: 20_00 });
    const first = await buy(world, productId);
    const second = await buy(world, productId);
    const third = await buy(world, productId);
    expect([first.status, second.status, third.status]).toEqual(Array(3).fill("awaiting_approval"));

    await approvePurchase(world.deps, { purchaseId: first.id, userId: world.owner.id });
    await approvePurchase(world.deps, { purchaseId: second.id, userId: world.owner.id });
    // The teen's $40 limit is now used up.
    const refused = await approvePurchase(world.deps, { purchaseId: third.id, userId: world.owner.id });

    expect(refused.status).toBe("rejected_by_rules");
    expect(refused.rule_code).toBe("over_member_limit");
    expect(world.rail.charges).toHaveLength(2);
  });

  it("refuses approve, deny and refund from anyone but the owner", async () => {
    const world = await createWorld();
    const waiting = await buy(world, await world.addProduct({ priceCents: 20_00 }));
    const captured = await buy(world, await world.addProduct({ priceCents: 5_00 }));
    const asTeen = { userId: world.teenUser.id };

    await expect(approvePurchase(world.deps, { purchaseId: waiting.id, ...asTeen })).rejects.toThrow(/owner/);
    await expect(denyPurchase(world.deps, { purchaseId: waiting.id, ...asTeen })).rejects.toThrow(/owner/);
    await expect(refundPurchase(world.deps, { purchaseId: captured.id, ...asTeen })).rejects.toThrow(/owner/);
    expect(world.rail.charges).toHaveLength(1);
    expect(world.rail.refunds).toHaveLength(0);
  });

  it("denies a waiting purchase without moving money", async () => {
    const world = await createWorld();
    const waiting = await buy(world, await world.addProduct({ priceCents: 20_00 }));
    const denied = await denyPurchase(world.deps, { purchaseId: waiting.id, userId: world.owner.id });

    expect(denied.status).toBe("denied");
    expect(world.rail.charges).toHaveLength(0);
  });

  it("refunds to the payer without making the money spendable again", async () => {
    const world = await createWorld();
    const purchase = await buy(world, await world.addProduct({ priceCents: 10_00 }));
    const refunded = await refundPurchase(world.deps, { purchaseId: purchase.id, userId: world.owner.id });

    expect(refunded.status).toBe("refunded");
    const { pool, teen } = await world.reload();
    expect(pool.refunded_cents).toBe(10_00);
    // Captured stays captured, so neither the pool nor the member's limit gets it back.
    expect(pool.captured_cents).toBe(10_00);
    expect(teen.captured_cents).toBe(10_00);
  });

  it("puts a purchase back to captured when PayPal refuses the refund", async () => {
    const world = await createWorld();
    const purchase = await buy(world, await world.addProduct({ priceCents: 10_00 }));
    world.rail.nextRefund = { outcome: "failed", code: "REFUND_FAILED", message: "Refund failed" };
    const result = await refundPurchase(world.deps, { purchaseId: purchase.id, userId: world.owner.id });

    expect(result.status).toBe("captured");
    expect((await world.reload()).pool.refunded_cents).toBe(0);
  });
});

describe("closing a pool", () => {
  it("releases what was never spent and stops further spending", async () => {
    const world = await createWorld();
    const productId = await world.addProduct({ priceCents: 6_00 });
    await buy(world, productId);
    const waiting = await buy(world, await world.addProduct({ priceCents: 20_00 }));

    const closed = await closePool(world.deps, { poolId: world.pool.id, userId: world.owner.id });
    expect(closed.status).toBe("closed");
    expect(closed.released_cents).toBe(144_00);
    expect(world.rail.releases).toEqual([`AUTH-${world.pool.id}`]);

    const after = await buy(world, productId);
    expect(after.rule_code).toBe("pool_not_active");
    const [expired] = await world.db.query<{ status: string }>("SELECT status FROM purchases WHERE id = $1", [waiting.id]);
    expect(expired.status).toBe("expired");
  });

  it("won't close while a payment is still unsettled", async () => {
    const world = await createWorld();
    world.rail.nextCharge = { outcome: "unknown", reason: "timeout" };
    await buy(world, await world.addProduct({ priceCents: 6_00 }));

    await expect(closePool(world.deps, { poolId: world.pool.id, userId: world.owner.id })).rejects.toThrow(/still settling/);
    expect(world.rail.releases).toHaveLength(0);
  });

  it("stays in closing when the release is unclear, and a retry finishes it", async () => {
    const world = await createWorld();
    world.rail.nextRelease = { outcome: "unknown", reason: "timeout" };
    const stuck = await closePool(world.deps, { poolId: world.pool.id, userId: world.owner.id });
    expect(stuck.status).toBe("closing");
    expect(stuck.released_cents).toBe(0);

    const closed = await closePool(world.deps, { poolId: world.pool.id, userId: world.owner.id });
    expect(closed.status).toBe("closed");
    expect(closed.released_cents).toBe(150_00);
  });

  it("is refused for anyone but the owner", async () => {
    const world = await createWorld();
    await expect(closePool(world.deps, { poolId: world.pool.id, userId: world.teenUser.id })).rejects.toThrow(/owner/);
  });
});

describe("database backstop", () => {
  it("refuses a row that would overspend the pool or a member's limit", async () => {
    const world = await createWorld();
    await expect(
      world.db.query("UPDATE pools SET captured_cents = authorized_cents + 1 WHERE id = $1", [world.pool.id]),
    ).rejects.toThrow();
    await expect(
      world.db.query("UPDATE pool_members SET captured_cents = limit_cents + 1 WHERE id = $1", [world.teen.id]),
    ).rejects.toThrow();
  });
});
