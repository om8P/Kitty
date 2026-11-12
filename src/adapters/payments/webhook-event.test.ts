import { describe, expect, it } from "vitest";
import { parseWebhookEvent } from "./webhook-event";

// Synthetic events in the shape S07 recorded (docs/spike/S07.md). No real PayPal IDs.
const base = "https://api.sandbox.paypal.com";

function event(type: string, resource: Record<string, unknown>) {
  return JSON.stringify({ id: `WH-${type}`, event_type: type, resource_type: "x", resource });
}

describe("parseWebhookEvent", () => {
  it("reads a completed capture: purchase from the invoice ID, and its authorization", () => {
    const parsed = parseWebhookEvent(
      event("PAYMENT.CAPTURE.COMPLETED", {
        id: "CAP-1",
        status: "COMPLETED",
        amount: { currency_code: "USD", value: "20.00" },
        invoice_id: "kitty-purchase-1",
        supplementary_data: { related_ids: { authorization_id: "AUTH-1", order_id: "ORDER-1" } },
      }),
    );
    expect(parsed).toEqual({
      ok: true,
      eventId: "WH-PAYMENT.CAPTURE.COMPLETED",
      type: "PAYMENT.CAPTURE.COMPLETED",
      event: {
        eventId: "WH-PAYMENT.CAPTURE.COMPLETED",
        kind: "capture_completed",
        type: "PAYMENT.CAPTURE.COMPLETED",
        purchaseId: "purchase-1",
        captureId: "CAP-1",
        refundId: null,
        authorizationId: "AUTH-1",
        amountCents: 20_00,
      },
    });
  });

  it.each([
    ["PAYMENT.CAPTURE.DECLINED", "capture_declined"],
    ["PAYMENT.CAPTURE.DENIED", "capture_denied"],
  ])("reads %s as a capture failure", (type, kind) => {
    const parsed = parseWebhookEvent(event(type, { id: "CAP-2", invoice_id: "kitty-purchase-2" }));
    expect(parsed).toMatchObject({ ok: true, event: { kind, purchaseId: "purchase-2", captureId: "CAP-2" } });
  });

  it("reads a refund: the refunded capture comes from its up link", () => {
    const parsed = parseWebhookEvent(
      event("PAYMENT.CAPTURE.REFUNDED", {
        id: "REF-1",
        status: "COMPLETED",
        amount: { currency_code: "USD", value: "40.00" },
        invoice_id: "kitty-purchase-3",
        links: [
          { rel: "self", href: `${base}/v2/payments/refunds/REF-1` },
          { rel: "up", href: `${base}/v2/payments/captures/CAP-3` },
        ],
      }),
    );
    expect(parsed).toMatchObject({
      ok: true,
      event: { kind: "capture_refunded", purchaseId: "purchase-3", captureId: "CAP-3", refundId: "REF-1", amountCents: 40_00 },
    });
  });

  it.each([
    ["PAYMENT.AUTHORIZATION.CREATED", "authorization_created"],
    ["PAYMENT.AUTHORIZATION.VOIDED", "authorization_voided"],
  ])("reads %s with the authorization as the resource and no purchase", (type, kind) => {
    const parsed = parseWebhookEvent(event(type, { id: "AUTH-9", invoice_id: "order-invoice" }));
    expect(parsed).toMatchObject({ ok: true, event: { kind, authorizationId: "AUTH-9", purchaseId: null, captureId: null } });
  });

  it("ignores an invoice ID Kitty didn't write", () => {
    const parsed = parseWebhookEvent(event("PAYMENT.CAPTURE.COMPLETED", { id: "CAP-4", invoice_id: "someone-else" }));
    expect(parsed).toMatchObject({ ok: true, event: { purchaseId: null } });
  });

  it("returns no event for a kind Kitty doesn't use", () => {
    expect(parseWebhookEvent(event("CHECKOUT.ORDER.APPROVED", { id: "ORDER-1" }))).toEqual({
      ok: true,
      eventId: "WH-CHECKOUT.ORDER.APPROVED",
      type: "CHECKOUT.ORDER.APPROVED",
      event: null,
    });
  });

  it.each(["", "not json", "[]", "null", JSON.stringify({ id: "x" }), JSON.stringify({ event_type: "PAYMENT.CAPTURE.COMPLETED" })])(
    "refuses a body that isn't an event: %s",
    (body) => {
      expect(parseWebhookEvent(body)).toEqual({ ok: false });
    },
  );
});
