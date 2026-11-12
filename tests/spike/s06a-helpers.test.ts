import { describe, expect, it } from "vitest";
import {
  CAPTURE_AMOUNTS,
  ORDER_AMOUNT,
  PROBES,
  capacityVerdict,
  captureRequestId,
  compareRefundReplay,
  extractIssue,
  isProbeLabel,
  probeRequestId,
  refundRequestId,
  summarizeRefund,
  voidRequestId,
} from "../../scripts/spike/s06a-helpers";
import type { CallSummary } from "../../scripts/spike/s05-helpers";

const cents = (value: string) => Math.round(Number(value) * 100);

describe("probe sizing", () => {
  const authorized = cents(ORDER_AMOUNT);
  const captured = CAPTURE_AMOUNTS.reduce((sum, amount) => sum + cents(amount), 0);
  const refunded = cents(CAPTURE_AMOUNTS[2]);

  it("leaves the three captures under the authorization", () => {
    expect(captured).toBeLessThan(authorized);
  });

  it("puts the control probe above a 115% over-capture allowance", () => {
    expect(captured + cents(PROBES.control)).toBeGreaterThan(authorized * 1.15);
  });

  it("fits the after-refund probe only if the refund restored capacity", () => {
    expect(captured - refunded + cents(PROBES["after-refund"])).toBeLessThanOrEqual(authorized);
    expect(captured + cents(PROBES["after-refund"])).toBeGreaterThan(authorized * 1.15);
  });
});

describe("request IDs", () => {
  it("are distinct per call and stable across runs", () => {
    const ids = [
      captureRequestId("AUTH", 1),
      captureRequestId("AUTH", 2),
      probeRequestId("AUTH", "control"),
      probeRequestId("AUTH", "after-refund"),
      refundRequestId("CAP"),
      refundRequestId("CAP", "again"),
      voidRequestId("AUTH"),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    expect(refundRequestId("CAP")).toBe(refundRequestId("CAP"));
  });

  it("recognises only known probe labels", () => {
    expect(isProbeLabel("control")).toBe(true);
    expect(isProbeLabel("toString")).toBe(false);
    expect(isProbeLabel(undefined)).toBe(false);
  });
});

describe("capacityVerdict", () => {
  const ok: CallSummary = { outcome: "succeeded", captureId: "C" };
  const refused: CallSummary = { outcome: "failed", code: "AMOUNT_EXCEEDED" };
  const unclear: CallSummary = { outcome: "unknown", reason: "timeout" };
  const unsupported: CallSummary = { outcome: "unsupported", code: "X" };

  it("is restored when the control is refused and the later probe fits", () => {
    expect(capacityVerdict(refused, ok)).toBe("restored");
  });

  it("is not restored when both are refused", () => {
    expect(capacityVerdict(refused, refused)).toBe("not_restored");
  });

  it("is inconclusive when the control did not fail", () => {
    for (const control of [ok, unclear, unsupported]) {
      for (const after of [ok, refused, unclear]) expect(capacityVerdict(control, after)).toBe("inconclusive");
    }
  });

  it("is inconclusive when the later probe is unclear", () => {
    expect(capacityVerdict(refused, unclear)).toBe("inconclusive");
    expect(capacityVerdict(refused, unsupported)).toBe("inconclusive");
  });
});

describe("refund summaries", () => {
  it("keeps the refund ID, status and amount on success", () => {
    expect(
      summarizeRefund({
        outcome: "succeeded",
        data: { id: "R1", status: "COMPLETED", amount: { currency_code: "USD", value: "40.00" } },
        httpStatus: 201,
      }),
    ).toEqual({ outcome: "succeeded", refundId: "R1", status: "COMPLETED", amount: "40.00", httpStatus: 201, debugId: undefined });
  });

  it("keeps the reason on unknown and the code on failure", () => {
    expect(summarizeRefund({ outcome: "unknown", reason: "unrecognized_error", httpStatus: 422 })).toMatchObject({
      outcome: "unknown",
      reason: "unrecognized_error",
    });
    expect(summarizeRefund({ outcome: "failed", code: "REFUND_FAILED", message: "m" })).toMatchObject({ code: "REFUND_FAILED" });
  });

  it("compares a replay with the original refund", () => {
    expect(compareRefundReplay("R1", { outcome: "succeeded", refundId: "R1" })).toBe("returned_original");
    expect(compareRefundReplay("R1", { outcome: "succeeded", refundId: "R2" })).toBe("new_refund");
    expect(compareRefundReplay("R1", { outcome: "unknown", reason: "timeout" })).toBe("not_returned");
  });
});

describe("extractIssue", () => {
  it("reads PayPal's error name and issue codes", () => {
    const body = JSON.stringify({
      name: "UNPROCESSABLE_ENTITY",
      details: [{ issue: "CAPTURE_FULLY_REFUNDED", description: "The capture has already been fully refunded" }],
      debug_id: "d",
    });
    expect(extractIssue(body)).toEqual({
      name: "UNPROCESSABLE_ENTITY",
      issues: ["CAPTURE_FULLY_REFUNDED"],
      description: "The capture has already been fully refunded",
    });
  });

  it("returns nothing for empty, non-JSON or success bodies", () => {
    expect(extractIssue(undefined)).toBeUndefined();
    expect(extractIssue("")).toBeUndefined();
    expect(extractIssue("<html>")).toBeUndefined();
    expect(extractIssue("null")).toBeUndefined();
    expect(extractIssue(JSON.stringify({ id: "R1", status: "COMPLETED" }))).toBeUndefined();
  });

  it("skips malformed details", () => {
    expect(extractIssue(JSON.stringify({ name: "X", details: [null, 3, { issue: 5 }, { issue: "Y" }] }))).toEqual({
      name: "X",
      issues: ["Y"],
      description: undefined,
    });
  });
});
