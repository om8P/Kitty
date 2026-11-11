import { describe, expect, it } from "vitest";
import { createRail } from "./rail";

describe("createRail", () => {
  it("refuses every call when no PayPal keys are set, instead of simulating payments", async () => {
    const rail = createRail({});
    expect(rail.name).toBe("unconfigured");

    const results = await Promise.all([
      rail.createPoolPayment({ poolId: "p", amountCents: 10_00, returnUrl: "http://x/r", cancelUrl: "http://x/c" }),
      rail.confirmPoolPayment({ poolId: "p", orderId: "o" }),
      rail.charge({ purchaseId: "c", authorizationId: "a", amountCents: 1_00 }),
      rail.refund({ purchaseId: "c", captureId: "k" }),
      rail.releaseHold({ authorizationId: "a" }),
    ]);
    for (const result of results) {
      expect(result).toMatchObject({ outcome: "unsupported", code: "PAYPAL_NOT_SET_UP" });
    }
  });

  it("uses PayPal when both keys are set", () => {
    expect(createRail({ PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" }).name).toBe("paypal");
  });
});
