import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWorld, type World } from "@/domain/testing";

const getContainer = vi.hoisted(() => vi.fn());
vi.mock("@/server/container", () => ({ getContainer }));

import { POST } from "./route";

// Synthetic only. The fake rail stands in for PayPal's signature check.
function post(body: string, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/paypal/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
}

describe("POST /api/paypal/webhook", () => {
  let world: World;
  beforeEach(async () => {
    world = await createWorld();
    getContainer.mockResolvedValue({ db: world.db, rail: world.rail });
  });

  it("answers 401 to an event whose signature fails", async () => {
    world.rail.nextVerify = { outcome: "failed", code: "signature_invalid", message: "bad" };
    const response = await POST(post("{}"));
    expect(response.status).toBe(401);
  });

  it("answers 503 when the signature couldn't be checked, so PayPal sends it again", async () => {
    world.rail.nextVerify = { outcome: "unknown", reason: "timeout" };
    expect((await POST(post("{}"))).status).toBe(503);
  });

  it("refuses a body far larger than any PayPal event, without checking it", async () => {
    let checked = false;
    world.rail.verifyWebhookSignature = async () => ((checked = true), { outcome: "failed", code: "x", message: "x" });
    expect((await POST(post("x".repeat(70_000)))).status).toBe(413);
    expect(checked).toBe(false);
  });

  it("passes the raw body through exactly as received", async () => {
    const raw = '{"id":"WH-1",  "event_type":"X"}';
    let seen = "";
    world.rail.verifyWebhookSignature = async ({ rawBody }) => {
      seen = rawBody;
      return { outcome: "succeeded", data: { event: null } };
    };
    const response = await POST(post(raw));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: "ignored" });
    expect(seen).toBe(raw);
  });

  it("answers 200 once an event is stored", async () => {
    const sent = {
      eventId: "WH-ROUTE-1",
      kind: "capture_completed" as const,
      type: "PAYMENT.CAPTURE.COMPLETED",
      purchaseId: "unknown-purchase",
      captureId: "CAP-1",
      refundId: null,
      authorizationId: null,
      amountCents: 1_00,
    };
    world.rail.nextVerify = { outcome: "succeeded", data: { event: sent } };
    const first = await POST(post("{}"));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ result: "stored", status: "unmatched" });
  });
});
