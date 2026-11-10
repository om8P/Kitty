import { describe, expect, it, vi } from "vitest";
import {
  MAX_CAPTURES,
  REDACTED,
  captureAmount,
  compareReplay,
  createLoggingFetch,
  plannedTotalCents,
  summarizeCapture,
  type LogEntry,
} from "../../scripts/spike/s05-helpers";

const BASE = "https://api-m.sandbox.paypal.com";

describe("capture schedule", () => {
  it("starts with three larger partial captures, then small ones", () => {
    expect([1, 2, 3, 4, 10].map(captureAmount)).toEqual(["20.00", "15.00", "10.00", "2.00", "2.00"]);
  });

  it("never plans more than the $150 authorization", () => {
    expect(plannedTotalCents(MAX_CAPTURES)).toBeLessThanOrEqual(15_000);
  });

  it("refuses capture numbers out of range", () => {
    expect(() => captureAmount(0)).toThrow();
    expect(() => captureAmount(MAX_CAPTURES + 1)).toThrow();
  });
});

describe("compareReplay", () => {
  it("recognises the original capture", () => {
    expect(compareReplay("CAP1", { outcome: "succeeded", captureId: "CAP1" })).toBe("returned_original");
  });

  it("flags a second capture as a double charge", () => {
    expect(compareReplay("CAP1", { outcome: "succeeded", captureId: "CAP2" })).toBe("new_capture");
  });

  it("treats errors and unknowns as not returned", () => {
    expect(compareReplay("CAP1", { outcome: "unknown", reason: "unrecognized_error" })).toBe("not_returned");
    expect(compareReplay("CAP1", { outcome: "failed", code: "X" })).toBe("not_returned");
  });
});

describe("summarizeCapture", () => {
  it("keeps only IDs, status and amount on success", () => {
    const summary = summarizeCapture({
      outcome: "succeeded",
      httpStatus: 201,
      data: { id: "CAP1", status: "COMPLETED", amount: { currency_code: "USD", value: "20.00" }, payer: { email: "x" } },
    });
    expect(summary).toEqual({ outcome: "succeeded", captureId: "CAP1", status: "COMPLETED", amount: "20.00", httpStatus: 201, debugId: undefined });
  });
});

describe("createLoggingFetch", () => {
  function setup(body: string, status = 200) {
    const entries: LogEntry[] = [];
    const base = vi.fn(async () => new Response(body, { status, headers: { "paypal-debug-id": "dbg1" } }));
    const logged = createLoggingFetch(base as unknown as typeof fetch, (entry) => entries.push(entry));
    return { entries, base, logged };
  }

  it("never logs the Authorization header or token bodies", async () => {
    const { entries, logged } = setup('{"access_token":"SECRET_TOKEN","expires_in":3600}');
    await logged(`${BASE}/v1/oauth2/token`, {
      method: "POST",
      headers: { Authorization: "Basic SECRET_CREDENTIALS" },
      body: "grant_type=client_credentials",
    });
    const text = JSON.stringify(entries);
    expect(text).not.toContain("SECRET");
    expect(entries[0]).toMatchObject({ requestBody: REDACTED, responseBody: REDACTED, status: 200 });
  });

  it("logs request ID, bodies and debug ID for API calls, without the bearer token", async () => {
    const { entries, logged } = setup('{"id":"CAP1"}', 201);
    const response = await logged(`${BASE}/v2/payments/authorizations/A1/capture`, {
      method: "POST",
      headers: { Authorization: "Bearer SECRET_TOKEN", "PayPal-Request-Id": "s05-capture-A1-1" },
      body: '{"amount":{"currency_code":"USD","value":"20.00"}}',
    });
    expect(await response.text()).toBe('{"id":"CAP1"}');
    expect(JSON.stringify(entries)).not.toContain("SECRET");
    expect(entries[0]).toMatchObject({
      method: "POST",
      path: "/v2/payments/authorizations/A1/capture",
      requestId: "s05-capture-A1-1",
      status: 201,
      debugId: "dbg1",
      responseBody: '{"id":"CAP1"}',
    });
  });

  it("logs and rethrows network errors", async () => {
    const entries: LogEntry[] = [];
    const failing = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const logged = createLoggingFetch(failing as unknown as typeof fetch, (entry) => entries.push(entry));
    await expect(logged(`${BASE}/v2/checkout/orders/O1`)).rejects.toThrow("fetch failed");
    expect(entries[0]).toMatchObject({ method: "GET", error: "TypeError: fetch failed" });
  });
});
