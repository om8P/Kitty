import { describe, expect, it } from "vitest";
import type { PayPalClient, PayPalResult } from "./paypal-client";
import { createPayPalRail, createRail } from "./rail";

// Synthetic values only. No real PayPal data.
const headers = { get: () => null };

type Outcome = "succeeded" | "failed" | "unsupported" | "unknown";

function result<T>(outcome: Outcome, data: T): PayPalResult<T> {
  if (outcome === "succeeded") return { outcome, data, httpStatus: 200 };
  if (outcome === "unknown") return { outcome, reason: "timeout" };
  return { outcome, code: "TEST_CODE", message: "test" };
}

/** A client stub that records every request ID it is sent. */
function stubClient(outcome: Outcome = "succeeded") {
  const requestIds: Record<string, string[]> = {};
  const record = (call: string, requestId: string) => (requestIds[call] ??= []).push(requestId);
  const authorization = { id: "AUTH-1", status: "CREATED", amount: { currency_code: "USD", value: "150.00" } };
  const client = {
    async createOrder(input: { requestId: string }) {
      record("createOrder", input.requestId);
      return result(outcome, { order: { id: "ORDER-1", status: "CREATED" }, approvalUrl: "https://example.test/approve" });
    },
    async authorizeOrder(input: { requestId: string }) {
      record("authorizeOrder", input.requestId);
      return result(outcome, { order: { id: "ORDER-1", status: "COMPLETED" }, authorization });
    },
    async getOrder() {
      return result("unknown" as Outcome, { id: "ORDER-1", status: "COMPLETED" });
    },
    async getAuthorization() {
      return result("unknown" as Outcome, authorization);
    },
    async captureAuthorization(input: { requestId: string }) {
      record("captureAuthorization", input.requestId);
      return result(outcome, { id: "CAP-1", status: "COMPLETED" });
    },
    async refundCapture(input: { requestId: string }) {
      record("refundCapture", input.requestId);
      return result(outcome, { id: "REF-1", status: "COMPLETED" });
    },
    async voidAuthorization(input: { requestId: string }) {
      record("voidAuthorization", input.requestId);
      return result(outcome, {});
    },
    async getCapture() {
      return result(outcome, {
        id: "CAP-1",
        status: "COMPLETED",
        amount: { currency_code: "USD", value: "12.50" },
        invoice_id: "kitty-purchase-1",
      });
    },
    async verifyWebhookSignature() {
      return result(outcome, { verified: true as const });
    },
  };
  return { client: client as unknown as PayPalClient, requestIds };
}

const captureEvent = JSON.stringify({
  id: "WH-EVENT-1",
  event_type: "PAYMENT.CAPTURE.COMPLETED",
  resource: { id: "CAP-1", status: "COMPLETED", amount: { currency_code: "USD", value: "12.50" }, invoice_id: "kitty-p1" },
});

describe("createRail", () => {
  it("refuses every call when no PayPal keys are set, instead of simulating payments", async () => {
    const rail = createRail({});
    expect(rail.name).toBe("unconfigured");
    expect(rail.holdsRealFunds).toBe(false);

    const results = await Promise.all([
      rail.createPoolPayment({ poolId: "p", amountCents: 10_00, returnUrl: "http://x/r", cancelUrl: "http://x/c" }),
      rail.confirmPoolPayment({ poolId: "p", orderId: "o" }),
      rail.charge({ purchaseId: "c", authorizationId: "a", amountCents: 1_00 }),
      rail.refund({ purchaseId: "c", captureId: "k" }),
      rail.releaseHold({ authorizationId: "a" }),
      rail.verifyWebhookSignature({ rawBody: captureEvent, headers }),
      rail.getCapture({ captureId: "k" }),
    ]);
    for (const outcome of results) {
      expect(outcome).toMatchObject({ outcome: "unsupported", code: "PAYPAL_NOT_SET_UP" });
    }
  });

  it("uses PayPal when both keys are set, and says it holds real funds", () => {
    const rail = createRail({ PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" });
    expect(rail.name).toBe("paypal");
    expect(rail.holdsRealFunds).toBe(true);
  });
});

describe("PayPal rail retries", () => {
  it("sends the same request ID every time a write is retried", async () => {
    const { client, requestIds } = stubClient();
    const rail = createPayPalRail(client);
    for (let attempt = 0; attempt < 2; attempt++) {
      await rail.createPoolPayment({ poolId: "pool-1", amountCents: 150_00, returnUrl: "http://x/r", cancelUrl: "http://x/c" });
      await rail.confirmPoolPayment({ poolId: "pool-1", orderId: "ORDER-1" });
      await rail.charge({ purchaseId: "purchase-1", authorizationId: "AUTH-1", amountCents: 12_50 });
      await rail.refund({ purchaseId: "purchase-1", captureId: "CAP-1" });
      await rail.releaseHold({ authorizationId: "AUTH-1" });
    }
    expect(requestIds).toEqual({
      createOrder: ["kitty-order-pool-1", "kitty-order-pool-1"],
      authorizeOrder: ["kitty-auth-pool-1", "kitty-auth-pool-1"],
      captureAuthorization: ["kitty-capture-purchase-1", "kitty-capture-purchase-1"],
      refundCapture: ["kitty-refund-purchase-1", "kitty-refund-purchase-1"],
      voidAuthorization: ["kitty-void-AUTH-1", "kitty-void-AUTH-1"],
    });
  });
});

describe("verifyWebhookSignature", () => {
  it("returns the parsed event only when PayPal verifies it", async () => {
    const verified = await createPayPalRail(stubClient("succeeded").client).verifyWebhookSignature({
      rawBody: captureEvent,
      headers,
    });
    expect(verified).toMatchObject({
      outcome: "succeeded",
      data: { event: { eventId: "WH-EVENT-1", kind: "capture_completed", purchaseId: "p1", captureId: "CAP-1", amountCents: 12_50 } },
    });
  });

  it.each(["failed", "unsupported", "unknown"] as const)("passes a %s check through without an event", async (outcome) => {
    const checked = await createPayPalRail(stubClient(outcome).client).verifyWebhookSignature({
      rawBody: captureEvent,
      headers,
    });
    expect(checked.outcome).toBe(outcome);
    expect(checked).not.toHaveProperty("data");
  });

  it("refuses a body that isn't a PayPal event without asking PayPal", async () => {
    const checked = await createPayPalRail(stubClient("succeeded").client).verifyWebhookSignature({
      rawBody: "[1,2]",
      headers,
    });
    expect(checked).toMatchObject({ outcome: "failed", code: "invalid_webhook_body" });
  });
});

describe("getCapture", () => {
  it("reads the capture's amount and the purchase from its invoice ID", async () => {
    const read = await createPayPalRail(stubClient("succeeded").client).getCapture({ captureId: "CAP-1" });
    expect(read).toEqual({
      outcome: "succeeded",
      data: { captureId: "CAP-1", status: "COMPLETED", amountCents: 12_50, purchaseId: "purchase-1" },
    });
  });

  it.each(["failed", "unsupported", "unknown"] as const)("passes a %s read through", async (outcome) => {
    const read = await createPayPalRail(stubClient(outcome).client).getCapture({ captureId: "CAP-1" });
    expect(read.outcome).toBe(outcome);
  });
});
