import { describe, expect, it } from "vitest";
import { createRail } from "@/adapters/payments/rail";
import { openTestDatabase } from "@/db/testing";
import { closePool, confirmPool, createDemoHousehold, createPool } from "./pools";
import { createFakeRail, createWorld } from "./testing";

type AuthorizationRow = {
  id: string;
  pool_id: string;
  previous_authorization_id: string | null;
  paypal_authorization_id: string;
  amount_cents: number;
  honor_ends_at: Date;
  expires_at: Date;
  status: string;
};

const DAY_MS = 86_400_000;

describe("the pool's authorization row (arch 5.1)", () => {
  it("is written when the pool opens, with PayPal's amount and expiry", async () => {
    const db = await openTestDatabase();
    const household = await createDemoHousehold(db);
    const rail = createFakeRail();
    const expiresAt = new Date("2026-12-10T12:00:00.000Z");
    rail.confirmPoolPayment = async ({ poolId }) => ({
      outcome: "succeeded",
      data: { authorizationId: `AUTH-${poolId}`, authorizedCents: 120_00, expiresAt },
    });
    const { pool } = await createPool(
      { db, rail },
      {
        householdId: household.householdId,
        ownerUserId: household.owner.id,
        goal: "Weekly groceries",
        amountCents: 120_00,
        termDays: 7,
        members: [
          {
            kind: "agent",
            userId: null,
            label: "Shopping agent",
            limitCents: 20_00,
            approvalThresholdCents: 10_00,
            allowedStores: ["Fresh Market"],
          },
        ],
      },
      { returnUrl: "http://localhost/return", cancelUrl: "http://localhost/cancel" },
    );

    const opened = await confirmPool(
      { db, rail },
      { orderId: pool.paypal_order_id as string, householdId: household.householdId },
    );
    const rows = await db.query<AuthorizationRow>("SELECT * FROM authorizations WHERE pool_id = $1", [pool.id]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: `auth_${pool.id}`,
      previous_authorization_id: null,
      paypal_authorization_id: opened.authorization_id,
      amount_cents: 120_00,
      status: "active",
    });
    expect(new Date(rows[0].expires_at).toISOString()).toBe(expiresAt.toISOString());
    expect(new Date(rows[0].honor_ends_at).getTime()).toBe(expiresAt.getTime() - 26 * DAY_MS);
  });

  it("falls back to a 29-day hold with a 3-day honor period when PayPal gives no expiry", async () => {
    const world = await createWorld();
    const [row] = await world.db.query<AuthorizationRow>("SELECT * FROM authorizations WHERE pool_id = $1", [
      world.pool.id,
    ]);
    const expires = new Date(row.expires_at).getTime();
    const honor = new Date(row.honor_ends_at).getTime();

    expect(expires).toBe(new Date(world.pool.hold_expires_at as Date).getTime());
    expect(expires - honor).toBe(26 * DAY_MS);
    expect(row.amount_cents).toBe(world.pool.authorized_cents);
  });

  it("is not written twice when the owner returns from PayPal again", async () => {
    const world = await createWorld();
    await confirmPool(
      { db: world.db, rail: world.rail },
      { orderId: world.pool.paypal_order_id as string, householdId: world.householdId },
    );
    const rows = await world.db.query("SELECT id FROM authorizations WHERE pool_id = $1", [world.pool.id]);
    expect(rows).toHaveLength(1);
  });

  it("is marked voided when closing releases the remainder", async () => {
    const world = await createWorld();
    await closePool(world.deps, { poolId: world.pool.id, userId: world.owner.id });
    const [row] = await world.db.query<AuthorizationRow>("SELECT status FROM authorizations WHERE pool_id = $1", [
      world.pool.id,
    ]);
    expect(row.status).toBe("voided");
  });

  it("stays active while PayPal has not confirmed the release", async () => {
    const world = await createWorld();
    world.rail.nextRelease = { outcome: "unknown", reason: "timeout" };
    await closePool(world.deps, { poolId: world.pool.id, userId: world.owner.id });
    const [row] = await world.db.query<AuthorizationRow>("SELECT status FROM authorizations WHERE pool_id = $1", [
      world.pool.id,
    ]);
    expect(row.status).toBe("active");
  });
});

describe("createPool without PayPal", () => {
  it("fails with a plain message and creates no pool", async () => {
    const db = await openTestDatabase();
    const household = await createDemoHousehold(db);

    await expect(
      createPool(
        { db, rail: createRail({}) },
        {
          householdId: household.householdId,
          ownerUserId: household.owner.id,
          goal: "Weekly groceries",
          amountCents: 50_00,
          termDays: 7,
          members: [
            {
              kind: "agent",
              userId: null,
              label: "Shopping agent",
              limitCents: 20_00,
              approvalThresholdCents: 10_00,
              allowedStores: ["Fresh Market"],
            },
          ],
        },
        { returnUrl: "http://localhost/return", cancelUrl: "http://localhost/cancel" },
      ),
    ).rejects.toThrow("PayPal isn't set up");

    const pools = await db.query("SELECT id FROM pools");
    expect(pools).toEqual([]);
  });
});
