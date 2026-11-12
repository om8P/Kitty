import { describe, expect, it } from "vitest";
import { confirmPool, createPool } from "@/domain/pools";
import { approvePurchase, submitPurchase } from "@/domain/purchases";
import { createWorld, type World } from "@/domain/testing";
import { newId, type AgentRunRow, type PoolRow, type PurchaseRow } from "@/domain/types";
import { runTick } from "./tick";

// A controlled clock: "now" is fixed when the file loads, and rows are aged by
// moving their timestamps back. It stays close to the database's own now(),
// which the app uses when it writes rows.
const NOW = new Date();
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

function tick(world: World, now = NOW) {
  return runTick({ db: world.db, purchases: world.deps, now: () => now });
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

async function purchase(world: World, id: string) {
  const [row] = await world.db.query<PurchaseRow>("SELECT * FROM purchases WHERE id = $1", [id]);
  return row;
}

async function pool(world: World) {
  const [row] = await world.db.query<PoolRow>("SELECT * FROM pools WHERE id = $1", [world.pool.id]);
  return row;
}

/** A $10 capture PayPal didn't confirm, reserved at `reservedAt`. */
async function unknownCapture(world: World, reservedAt = minutesAgo(10)) {
  world.rail.nextCharge = { outcome: "unknown", reason: "timeout" };
  const bought = await buy(world, 10_00);
  expect(bought.status).toBe("capture_unknown");
  await world.db.query("UPDATE ledger_entries SET created_at = $2 WHERE purchase_id = $1", [bought.id, reservedAt]);
  return bought;
}

describe("the tick", () => {
  it("sends a review cut off by a restart to the owner, and leaves a recent one alone", async () => {
    const world = await createWorld();
    const productId = await world.addProduct({ priceCents: 5_00 });
    const insert = async (updatedAt: Date) => {
      const id = newId();
      await world.db.query(
        `INSERT INTO purchases (id, pool_id, member_id, product_id, product_title, store, quantity, amount_cents, status, idempotency_key, updated_at)
         VALUES ($1, $2, $3, $4, 'Test item', 'Fresh Market', 1, 500, 'reviewing', $1, $5)`,
        [id, world.pool.id, world.teen.id, productId, updatedAt],
      );
      return id;
    };
    const stale = await insert(minutesAgo(6));
    const fresh = await insert(minutesAgo(1));

    expect((await tick(world)).jobs.staleReviews).toBe(1);
    expect(await purchase(world, stale)).toMatchObject({
      status: "awaiting_approval",
      approval_reason: "AI review unavailable",
      ai_decision: "unavailable",
    });
    expect((await purchase(world, stale)).approval_expires_at).not.toBeNull();
    expect((await purchase(world, fresh)).status).toBe("reviewing");
    expect((await pool(world)).reserved_cents).toBe(0);
  });

  it("treats a capture cut off by a restart as unknown and keeps its money reserved", async () => {
    const world = await createWorld();
    const bought = await buy(world, 10_00);
    // Put it back mid-capture, as if the process died after reserving.
    await world.db.query("UPDATE purchases SET status = 'capturing', capture_id = NULL, updated_at = $2 WHERE id = $1", [
      bought.id,
      minutesAgo(3),
    ]);
    await world.db.query("UPDATE pools SET reserved_cents = 1000, captured_cents = 0 WHERE id = $1", [world.pool.id]);
    await world.db.query("UPDATE pool_members SET reserved_cents = 1000, captured_cents = 0 WHERE id = $1", [
      world.teen.id,
    ]);
    world.rail.nextCharge = { outcome: "unknown", reason: "timeout" };

    const report = await tick(world);
    expect(report.jobs).toMatchObject({ staleCaptures: 1, replayedCaptures: 1 });
    expect((await purchase(world, bought.id)).status).toBe("capture_unknown");
    expect((await pool(world)).reserved_cents).toBe(10_00);
  });

  it("replays an unknown capture with its own request ID and settles it", async () => {
    const world = await createWorld();
    const bought = await unknownCapture(world);

    expect((await tick(world)).jobs.replayedCaptures).toBe(1);
    expect(world.rail.charges.map((charge) => charge.purchaseId)).toEqual([bought.id, bought.id]);
    expect(await purchase(world, bought.id)).toMatchObject({ status: "captured", capture_id: `CAP-${bought.id}` });
    expect(await pool(world)).toMatchObject({ reserved_cents: 0, captured_cents: 10_00 });
  });

  it("returns the money only when the replay is a definite failure", async () => {
    const world = await createWorld();
    const bought = await unknownCapture(world);
    world.rail.nextCharge = { outcome: "failed", code: "INSTRUMENT_DECLINED", message: "declined" };

    await tick(world);
    expect((await purchase(world, bought.id)).status).toBe("capture_failed");
    expect(await pool(world)).toMatchObject({ reserved_cents: 0, captured_cents: 0 });
  });

  it("stops replaying after an hour and flags the purchase, with the money still reserved", async () => {
    const world = await createWorld();
    const bought = await unknownCapture(world, minutesAgo(61));

    const report = await tick(world);
    expect(report.jobs).toMatchObject({ replayedCaptures: 0, stoppedReplays: 1 });
    expect(world.rail.charges).toHaveLength(1);
    expect(await purchase(world, bought.id)).toMatchObject({ status: "capture_unknown", needs_attention: true });
    expect((await pool(world)).reserved_cents).toBe(10_00);

    expect((await tick(world)).jobs.stoppedReplays).toBe(0);
  });

  it("expires waiting approvals past their expiry, including ones made before expiries were recorded", async () => {
    const world = await createWorld();
    const due = await buy(world, 20_00);
    const legacy = await buy(world, 21_00);
    const waiting = await buy(world, 22_00);
    expect([due.status, legacy.status, waiting.status]).toEqual(["awaiting_approval", "awaiting_approval", "awaiting_approval"]);
    await world.db.query("UPDATE purchases SET approval_expires_at = $2 WHERE id = $1", [due.id, minutesAgo(1)]);
    await world.db.query("UPDATE purchases SET approval_expires_at = NULL, updated_at = $2 WHERE id = $1", [
      legacy.id,
      minutesAgo(25 * 60),
    ]);

    expect((await tick(world)).jobs.expiredApprovals).toBe(2);
    expect((await purchase(world, due.id)).status).toBe("expired");
    expect((await purchase(world, legacy.id)).status).toBe("expired");
    expect((await purchase(world, waiting.id)).status).toBe("awaiting_approval");
  });

  it("abandons a pool whose PayPal approval never finished, and still opens it if the owner comes back", async () => {
    const world = await createWorld();
    const { pool: started } = await createPool(
      { db: world.db, rail: world.rail },
      {
        householdId: world.householdId,
        ownerUserId: world.owner.id,
        goal: "Field trip",
        amountCents: 30_00,
        termDays: 3,
        members: [
          { kind: "agent", userId: null, label: "Shopping agent", limitCents: 10_00, approvalThresholdCents: 5_00, allowedStores: ["Fresh Market"] },
        ],
      },
      { returnUrl: "http://localhost/return", cancelUrl: "http://localhost/cancel" },
    );
    await world.db.query("UPDATE pools SET created_at = $2 WHERE id = $1", [started.id, minutesAgo(3 * 60 + 1)]);

    expect((await tick(world)).jobs.abandonedPools).toBe(1);
    const [abandoned] = await world.db.query<PoolRow>("SELECT * FROM pools WHERE id = $1", [started.id]);
    expect(abandoned.status).toBe("abandoned");
    expect((await tick(world)).jobs.abandonedPools).toBe(0);

    const opened = await confirmPool(
      { db: world.db, rail: world.rail },
      { orderId: started.paypal_order_id as string, householdId: world.householdId },
    );
    expect(opened).toMatchObject({ status: "active", note: null });
  });

  it("ends an agent run whose process died, and leaves a live one alone", async () => {
    const world = await createWorld();
    const insert = async (memberId: string, heartbeat: Date) => {
      const id = newId();
      await world.db.query(
        "INSERT INTO agent_runs (id, pool_id, member_id, task, status, heartbeat_at) VALUES ($1, $2, $3, 'Shop', 'running', $4)",
        [id, world.pool.id, memberId, heartbeat],
      );
      return id;
    };
    const dead = await insert(world.agent.id, minutesAgo(4));
    const live = await insert(world.teen.id, minutesAgo(1));

    expect((await tick(world)).jobs.staleAgentRuns).toBe(1);
    const runs = await world.db.query<AgentRunRow>("SELECT * FROM agent_runs");
    expect(runs.find((run) => run.id === dead)).toMatchObject({ status: "failed", error: "The run stopped unexpectedly." });
    expect(runs.find((run) => run.id === live)?.status).toBe("running");
  });

  it("is safe to run twice: the second run moves nothing and charges nothing", async () => {
    const world = await createWorld();
    await unknownCapture(world);
    const waiting = await buy(world, 20_00);
    await world.db.query("UPDATE purchases SET approval_expires_at = $2 WHERE id = $1", [waiting.id, minutesAgo(1)]);

    const first = await tick(world);
    expect(first.failed).toEqual([]);
    expect(first.jobs).toMatchObject({ replayedCaptures: 1, expiredApprovals: 1 });
    const charges = world.rail.charges.length;

    expect(await tick(world)).toEqual({
      jobs: {
        staleReviews: 0,
        staleCaptures: 0,
        replayedCaptures: 0,
        stoppedReplays: 0,
        expiredApprovals: 0,
        abandonedPools: 0,
        staleAgentRuns: 0,
      },
      failed: [],
    });
    expect(world.rail.charges).toHaveLength(charges);
  });
});

describe("approving an expired request", () => {
  it("expires it instead of charging, even before the tick runs", async () => {
    const world = await createWorld();
    const waiting = await buy(world, 20_00);
    await world.db.query("UPDATE purchases SET approval_expires_at = now() - interval '1 minute' WHERE id = $1", [
      waiting.id,
    ]);
    await expect(approvePurchase(world.deps, { purchaseId: waiting.id, userId: world.owner.id })).rejects.toThrow(
      "expired before it was approved",
    );
    expect((await purchase(world, waiting.id)).status).toBe("expired");
    expect(world.rail.charges).toHaveLength(0);
  });
});
