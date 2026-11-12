import { describe, expect, it } from "vitest";
import {
  deliveryFileName,
  headerSource,
  linkedId,
  parseDelivery,
  pickPayPalHeaders,
  summarizeEvent,
} from "../../scripts/spike/s07-helpers";

const base = "https://api.sandbox.paypal.com";

/** Synthetic events in PayPal's documented shape. No real ids. */
const captureCompleted = {
  id: "WH-TEST-1",
  event_type: "PAYMENT.CAPTURE.COMPLETED",
  create_time: "2026-11-11T10:00:00.000Z",
  resource_type: "capture",
  resource: {
    id: "CAP-1",
    status: "COMPLETED",
    amount: { currency_code: "USD", value: "20.00" },
    invoice_id: "kitty-purchase-1",
    supplementary_data: { related_ids: { order_id: "ORDER-1", authorization_id: "AUTH-1" } },
    links: [{ rel: "up", href: `${base}/v2/payments/authorizations/AUTH-1` }],
  },
};

const captureRefunded = {
  id: "WH-TEST-2",
  event_type: "PAYMENT.CAPTURE.REFUNDED",
  resource_type: "refund",
  resource: {
    id: "REF-1",
    status: "COMPLETED",
    amount: { currency_code: "USD", value: "20.00" },
    links: [
      { rel: "self", href: `${base}/v2/payments/refunds/REF-1` },
      { rel: "up", href: `${base}/v2/payments/captures/CAP-1` },
    ],
  },
};

const authorizationVoided = {
  id: "WH-TEST-3",
  event_type: "PAYMENT.AUTHORIZATION.VOIDED",
  resource_type: "authorization",
  resource: {
    id: "AUTH-1",
    status: "VOIDED",
    links: [{ rel: "up", href: `${base}/v2/checkout/orders/ORDER-1` }],
  },
};

describe("pickPayPalHeaders", () => {
  it("keeps PayPal's headers and the content type, and drops tunnel headers", () => {
    expect(
      pickPayPalHeaders({
        "PayPal-Transmission-Id": "T-1",
        "paypal-auth-algo": "SHA256withRSA",
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.9",
        "user-agent": "PayPal/AUHD-214.0",
        "paypal-multi": ["a", "b"],
        "paypal-missing": undefined,
      }),
    ).toEqual({
      "paypal-transmission-id": "T-1",
      "paypal-auth-algo": "SHA256withRSA",
      "content-type": "application/json",
      "paypal-multi": "a, b",
    });
  });
});

describe("parseDelivery and headerSource", () => {
  it("reads a saved delivery and exposes its headers case-insensitively", () => {
    const saved = JSON.stringify({ receivedAt: "t", method: "POST", path: "/webhook", headers: { "paypal-cert-url": "u" }, rawBody: "{}" });
    const delivery = parseDelivery(saved);
    expect(delivery?.rawBody).toBe("{}");
    expect(headerSource(delivery!.headers).get("PayPal-Cert-Url")).toBe("u");
    expect(headerSource(delivery!.headers).get("paypal-transmission-sig")).toBeNull();
  });

  it("rejects files that are not deliveries", () => {
    expect(parseDelivery("not json")).toBeUndefined();
    expect(parseDelivery(JSON.stringify({ headers: {} }))).toBeUndefined();
  });
});

describe("summarizeEvent", () => {
  it("identifies a capture, its invoice_id, authorization and order", () => {
    expect(summarizeEvent(JSON.stringify(captureCompleted))).toMatchObject({
      eventId: "WH-TEST-1",
      eventType: "PAYMENT.CAPTURE.COMPLETED",
      resourceId: "CAP-1",
      captureId: "CAP-1",
      amount: "20.00",
      invoiceId: "kitty-purchase-1",
      authorizationId: "AUTH-1",
      orderId: "ORDER-1",
    });
  });

  it("finds the refunded capture through the up link", () => {
    expect(summarizeEvent(JSON.stringify(captureRefunded))).toMatchObject({
      resourceType: "refund",
      resourceId: "REF-1",
      captureId: "CAP-1",
      invoiceId: undefined,
    });
  });

  it("treats an authorization resource as its own authorization", () => {
    expect(summarizeEvent(JSON.stringify(authorizationVoided))).toMatchObject({
      authorizationId: "AUTH-1",
      orderId: "ORDER-1",
      status: "VOIDED",
      captureId: undefined,
    });
  });

  it("returns undefined for bodies that are not event objects", () => {
    expect(summarizeEvent("[]")).toBeUndefined();
    expect(summarizeEvent("nope")).toBeUndefined();
  });
});

describe("linkedId", () => {
  it("reads the id from the link with the given rel", () => {
    expect(linkedId(captureRefunded.resource.links, "up", "captures")).toBe("CAP-1");
    expect(linkedId(captureRefunded.resource.links, "up", "orders")).toBeUndefined();
    expect(linkedId("not links", "up", "orders")).toBeUndefined();
  });
});

describe("deliveryFileName", () => {
  it("sorts by time and strips unsafe characters from the transmission id", () => {
    const at = new Date("2026-11-11T10:00:00.000Z");
    expect(deliveryFileName(at, "abc-123/../x", 7)).toBe("2026-11-11T10-00-00-000Z-007-abc-123x.json");
    expect(deliveryFileName(at, undefined, 1)).toBe("2026-11-11T10-00-00-000Z-001-no-id.json");
  });
});
