import { describe, expect, it } from "vitest";
import { createRail } from "@/adapters/payments/rail";
import { openTestDatabase } from "@/db/testing";
import { createDemoHousehold, createPool } from "./pools";

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
