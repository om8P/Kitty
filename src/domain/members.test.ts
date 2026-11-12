import { describe, expect, it } from "vitest";
import { addMember, removeMember, updateMember, type MemberRules } from "./members";
import { closePool, confirmPool, createPool } from "./pools";
import { approvePurchase, submitPurchase } from "./purchases";
import { createWorld, type World } from "./testing";
import { DomainError } from "./types";

const rules = (limitCents: number, extra: Partial<MemberRules> = {}): MemberRules => ({
  limitCents,
  approvalThresholdCents: 15_00,
  allowedStores: ["Fresh Market"],
  ...extra,
});

async function buy(world: World, priceCents: number, member: "teen" | "agent" = "teen") {
  const productId = await world.addProduct({ priceCents });
  return submitPurchase(world.deps, {
    poolId: world.pool.id,
    memberId: world[member].id,
    productId,
    quantity: 1,
    idempotencyKey: `key-${productId}`,
  });
}

describe("updateMember", () => {
  it("changes the limit, the approval amount and the stores, in the owner's order", async () => {
    const world = await createWorld();
    const updated = await updateMember(world.db, {
      poolId: world.pool.id,
      memberId: world.teen.id,
      userId: world.owner.id,
      rules: rules(30_00, { approvalThresholdCents: 0, allowedStores: ["Gadget Hub", "Fresh Market"] }),
    });
    expect(updated).toMatchObject({ limit_cents: 30_00, approval_threshold_cents: 0, allowed_stores: ["Gadget Hub", "Fresh Market"] });
  });

  it("refuses a limit below what the member has already used", async () => {
    const world = await createWorld();
    expect((await buy(world, 10_00)).status).toBe("captured");
    const lower = { poolId: world.pool.id, memberId: world.teen.id, userId: world.owner.id, rules: rules(9_99) };
    await expect(updateMember(world.db, lower)).rejects.toThrow("already used $10.00");
    const atUsed = await updateMember(world.db, { ...lower, rules: rules(10_00) });
    expect(atUsed.limit_cents).toBe(10_00);
  });

  it("caps a raise by what's left in the pool, but always allows a cut", async () => {
    // A $50 pool where the agent's $50 limit already covers the whole pool.
    const world = await createWorld({ amountCents: 50_00, members: { agent: { limitCents: 50_00 } } });
    expect((await buy(world, 10_00)).status).toBe("captured");
    const input = { poolId: world.pool.id, memberId: world.teen.id, userId: world.owner.id };

    // $10 used plus $40 left in the pool.
    await expect(updateMember(world.db, { ...input, rules: rules(50_01) })).rejects.toThrow("at most $50.00");
    expect((await updateMember(world.db, { ...input, rules: rules(50_00) })).limit_cents).toBe(50_00);

    // The agent's remaining $50 is above the $40 available, and lowering it is still fine.
    const cut = await updateMember(world.db, { ...input, memberId: world.agent.id, rules: rules(45_00) });
    expect(cut.limit_cents).toBe(45_00);
  });

  it("refuses bad rules, other users and closed pools", async () => {
    const world = await createWorld();
    const input = { poolId: world.pool.id, memberId: world.teen.id, userId: world.owner.id, rules: rules(20_00) };
    await expect(updateMember(world.db, { ...input, rules: rules(0) })).rejects.toThrow(DomainError);
    await expect(updateMember(world.db, { ...input, rules: rules(20_00, { allowedStores: [] }) })).rejects.toThrow(
      "Choose at least one store",
    );
    await expect(updateMember(world.db, { ...input, rules: rules(20_00, { allowedStores: ["Nowhere"] }) })).rejects.toThrow(
      "Choose at least one store",
    );
    await expect(updateMember(world.db, { ...input, userId: world.teenUser.id })).rejects.toMatchObject({ code: "forbidden" });

    await closePool({ db: world.db, rail: world.rail }, { poolId: world.pool.id, userId: world.owner.id });
    await expect(updateMember(world.db, input)).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("removeMember", () => {
  it("keeps the row and its spending, and stops new purchases and waiting approvals", async () => {
    const world = await createWorld();
    expect((await buy(world, 10_00)).status).toBe("captured");
    const waiting = await buy(world, 20_00);
    expect(waiting.status).toBe("awaiting_approval");

    const removed = await removeMember(world.db, { poolId: world.pool.id, memberId: world.teen.id, userId: world.owner.id });
    expect(removed).toMatchObject({ active: false, captured_cents: 10_00, limit_cents: 40_00 });

    expect(await buy(world, 5_00)).toMatchObject({ status: "rejected_by_rules", rule_code: "member_inactive" });
    const approved = await approvePurchase(world.deps, { purchaseId: waiting.id, userId: world.owner.id });
    expect(approved).toMatchObject({ status: "rejected_by_rules", rule_code: "member_inactive" });
    expect(world.rail.charges).toHaveLength(1);

    await expect(
      removeMember(world.db, { poolId: world.pool.id, memberId: world.teen.id, userId: world.owner.id }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      updateMember(world.db, { poolId: world.pool.id, memberId: world.teen.id, userId: world.owner.id, rules: rules(40_00) }),
    ).rejects.toThrow("Add them back first");
  });

  it("is for the owner only", async () => {
    const world = await createWorld();
    await expect(
      removeMember(world.db, { poolId: world.pool.id, memberId: world.agent.id, userId: world.teenUser.id }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("addMember", () => {
  it("switches a removed member back on, and what they spent still counts", async () => {
    const world = await createWorld();
    expect((await buy(world, 10_00)).status).toBe("captured");
    await removeMember(world.db, { poolId: world.pool.id, memberId: world.teen.id, userId: world.owner.id });

    const input = {
      poolId: world.pool.id,
      userId: world.owner.id,
      kind: "person" as const,
      memberUserId: world.teenUser.id,
      label: "Sam",
      rules: rules(5_00),
    };
    await expect(addMember(world.db, input)).rejects.toThrow("already used $10.00");
    const back = await addMember(world.db, { ...input, rules: rules(30_00) });
    expect(back).toMatchObject({ id: world.teen.id, active: true, limit_cents: 30_00, captured_cents: 10_00 });
    expect((await buy(world, 5_00)).status).toBe("captured");

    await expect(addMember(world.db, input)).rejects.toThrow("already in this pool");
  });

  it("adds a member the pool never had, capped by what's left in the pool", async () => {
    const world = await createWorld();
    // A second pool with only the agent.
    const { pool: created } = await createPool(
      { db: world.db, rail: world.rail },
      {
        householdId: world.householdId,
        ownerUserId: world.owner.id,
        goal: "School supplies",
        amountCents: 60_00,
        termDays: 7,
        members: [
          { kind: "agent", userId: null, label: "Shopping agent", limitCents: 20_00, approvalThresholdCents: 5_00, allowedStores: ["Fresh Market"] },
        ],
      },
      { returnUrl: "http://localhost/return", cancelUrl: "http://localhost/cancel" },
    );
    const pool = await confirmPool(
      { db: world.db, rail: world.rail },
      { orderId: created.paypal_order_id as string, householdId: world.householdId },
    );

    const input = {
      poolId: pool.id,
      userId: world.owner.id,
      kind: "person" as const,
      memberUserId: world.teenUser.id,
      label: "Sam",
      rules: rules(60_01, { allowedStores: ["Style Street", "Fresh Market"] }),
    };
    await expect(addMember(world.db, input)).rejects.toThrow("at most $60.00");
    const added = await addMember(world.db, { ...input, rules: rules(25_00, { allowedStores: ["Style Street", "Fresh Market"] }) });
    expect(added).toMatchObject({
      kind: "person",
      user_id: world.teenUser.id,
      label: "Sam",
      active: true,
      limit_cents: 25_00,
      position: 1,
      allowed_stores: ["Style Street", "Fresh Market"],
    });
  });

  it("needs a family member in the household to add a person", async () => {
    const world = await createWorld();
    await expect(
      addMember(world.db, {
        poolId: world.pool.id,
        userId: world.owner.id,
        kind: "person",
        memberUserId: null,
        label: "Family member",
        rules: rules(10_00),
      }),
    ).rejects.toThrow("no family member");
  });
});
