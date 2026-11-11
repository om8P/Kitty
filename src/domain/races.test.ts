/**
 * Race tests on real Postgres (architecture 7.1 and 7.2). Each one makes two
 * transactions overlap for certain: the test database pauses inside one
 * transaction while it holds the pool lock, and the second arrives during that
 * pause. Every test here fails when the `FOR UPDATE` locks are removed from
 * `purchases.ts` and `pools.ts` (checked by hand in N1, M2).
 */
import { describe, expect, it } from "vitest";
import { closePool } from "./pools";
import type { ReviewFacts, ReviewResult } from "./ports";
import { approvePurchase, submitPurchase } from "./purchases";
import { createWorld, type World } from "./testing";
import { DomainError } from "./types";

const HOLD_MS = 150;
const allow: ReviewResult = { decision: "allow", reason: "Fits the goal." };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const AFTER_POOL_READ = /^\s*SELECT \* FROM pools WHERE id = \$1/;
const AFTER_CLOSING = /UPDATE pools SET status = 'closing'/;
const AFTER_RESERVE = /UPDATE purchases SET status = 'capturing'/;

let keys = 0;
const buy = (world: World, productId: string, member: "teen" | "agent") =>
  submitPurchase(world.deps, {
    poolId: world.pool.id,
    memberId: world[member].id,
    productId,
    quantity: 1,
    idempotencyKey: `race-${keys++}`,
  });

/** Releases every review only once `count` reviews have started. */
function holdReviewsUntil(world: World, count: number) {
  let arrived = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  world.reviewer.review = async (facts: ReviewFacts) => {
    world.reviewer.calls.push(facts);
    arrived += 1;
    if (arrived >= count) release();
    await gate;
    return allow;
  };
}

function racingWorld(pauseAfter: RegExp, options: Parameters<typeof createWorld>[0] = {}) {
  return createWorld({ ...options, database: { pauses: [{ after: pauseAfter, ms: HOLD_MS }] } });
}

const close = (world: World) => closePool(world.deps, { poolId: world.pool.id, userId: world.owner.id });
const smallPool = { amountCents: 40_00, members: { agent: { limitCents: 40_00 } } };

describe("races on the pool lock", () => {
  it("lets exactly one of two $30 purchases through when $40 is available", async () => {
    const world = await racingWorld(AFTER_POOL_READ, {
      amountCents: 40_00,
      members: {
        teen: { limitCents: 40_00, approvalThresholdCents: 40_00 },
        agent: { limitCents: 40_00, approvalThresholdCents: 40_00 },
      },
    });
    const productId = await world.addProduct({ priceCents: 30_00 });
    holdReviewsUntil(world, 2);

    const results = await Promise.all([buy(world, productId, "teen"), buy(world, productId, "agent")]);

    expect(results.map((purchase) => purchase.status).sort()).toEqual(["captured", "rejected_by_rules"]);
    expect(results.find((purchase) => purchase.status === "rejected_by_rules")?.rule_code).toBe("over_pool_balance");
    expect(world.rail.charges).toHaveLength(1);
    const { pool, teen, agent } = await world.reload();
    expect([pool.reserved_cents, pool.captured_cents]).toEqual([0, 30_00]);
    expect(teen.captured_cents + agent.captured_cents).toBe(30_00);
    expect(teen.reserved_cents + agent.reserved_cents).toBe(0);
  });

  it("charges once when the owner approves the same purchase twice at once", async () => {
    const world = await racingWorld(AFTER_POOL_READ);
    // $20 is above the teen's $15 approval amount, so it waits for the owner.
    const waiting = await buy(world, await world.addProduct({ priceCents: 20_00 }), "teen");
    expect(waiting.status).toBe("awaiting_approval");

    const approve = () => approvePurchase(world.deps, { purchaseId: waiting.id, userId: world.owner.id });
    const results = await Promise.allSettled([approve(), approve()]);

    expect(world.rail.charges).toEqual([{ purchaseId: waiting.id, amountCents: 20_00 }]);
    for (const result of results) {
      if (result.status === "rejected") expect(result.reason).toBeInstanceOf(DomainError);
    }
    const { pool, teen } = await world.reload();
    expect([pool.reserved_cents, pool.captured_cents]).toEqual([0, 20_00]);
    expect([teen.reserved_cents, teen.captured_cents]).toEqual([0, 20_00]);
    const [entries] = await world.db.query<{ reserves: number }>(
      "SELECT count(*)::int AS reserves FROM ledger_entries WHERE purchase_id = $1 AND kind = 'reserve'",
      [waiting.id],
    );
    expect(entries.reserves).toBe(1);
  });

  it("reserves nothing once a close has started, when an approval races it", async () => {
    const world = await racingWorld(AFTER_CLOSING, smallPool);
    const waiting = await buy(world, await world.addProduct({ priceCents: 20_00 }), "teen");
    expect(waiting.status).toBe("awaiting_approval");

    // The close marks the pool closing and holds the lock. The approval arrives during that hold.
    const closing = close(world);
    await wait(HOLD_MS / 3);
    const approved = await approvePurchase(world.deps, { purchaseId: waiting.id, userId: world.owner.id });
    const closed = await closing;

    expect(approved.status).toBe("expired");
    expect(world.rail.charges).toHaveLength(0);
    expect(closed.status).toBe("closed");
    expect([closed.reserved_cents, closed.captured_cents, closed.released_cents]).toEqual([0, 0, 40_00]);
  });

  it("makes a close wait for a purchase that reserved first", async () => {
    const world = await racingWorld(AFTER_RESERVE, smallPool);
    const productId = await world.addProduct({ priceCents: 10_00 });
    let closing: Promise<unknown> | undefined;
    world.reviewer.review = async () => {
      // The purchase reserves and holds the lock. The close arrives during that hold.
      // Capture its outcome at once, so its refusal is never an unhandled rejection.
      closing = wait(HOLD_MS / 3)
        .then(() => close(world))
        .then(
          () => null,
          (error: unknown) => error,
        );
      return allow;
    };

    const purchase = await buy(world, productId, "teen");
    // The close saw a payment still settling, so it refused and changed nothing.
    const refusal = await closing;
    expect(refusal).toBeInstanceOf(DomainError);
    expect((refusal as DomainError).message).toContain("A payment is still settling");
    expect(purchase.status).toBe("captured");

    const closed = await close(world);
    expect(closed.status).toBe("closed");
    expect([closed.reserved_cents, closed.captured_cents, closed.released_cents]).toEqual([0, 10_00, 30_00]);
    expect(world.rail.charges).toHaveLength(1);
  });
});
