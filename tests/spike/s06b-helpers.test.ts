import { describe, expect, it } from "vitest";
import {
  centsToValue,
  compareReauthReplay,
  extractIssue,
  honorEndsAt,
  hoursBetween,
  reauthRequestId,
  remainingCents,
  summarizeAuthorization,
} from "../../scripts/spike/s06b-helpers";

const usd = (value: string) => ({ currency_code: "USD", value });

describe("remainingCents", () => {
  it("subtracts completed and pending captures from the authorized amount", () => {
    const captures = [
      { status: "COMPLETED", amount: usd("20.00") },
      { status: "PENDING", amount: usd("15.00") },
      { status: "COMPLETED", amount: usd("2.00") },
    ];
    expect(remainingCents("150.00", captures)).toBe(11_300);
  });

  it("ignores declined and refunded captures", () => {
    const captures = [
      { status: "DECLINED", amount: usd("20.00") },
      { status: "REFUNDED", amount: usd("15.00") },
    ];
    expect(remainingCents("150.00", captures)).toBe(15_000);
  });

  it("never goes below zero", () => {
    expect(remainingCents("10.00", [{ status: "COMPLETED", amount: usd("12.00") }])).toBe(0);
  });
});

describe("centsToValue", () => {
  it("formats cents as a PayPal amount", () => {
    expect(centsToValue(5_100)).toBe("51.00");
    expect(centsToValue(5)).toBe("0.05");
  });

  it("refuses negative or fractional cents", () => {
    expect(() => centsToValue(-1)).toThrow();
    expect(() => centsToValue(1.5)).toThrow();
  });
});

describe("honor period", () => {
  it("ends three days after creation", () => {
    expect(honorEndsAt("2026-11-10T07:46:40Z").toISOString()).toBe("2026-11-13T07:46:40.000Z");
  });

  it("refuses an unreadable time", () => {
    expect(() => honorEndsAt("not a date")).toThrow();
  });

  it("measures hours between two times", () => {
    expect(hoursBetween(new Date("2026-11-10T00:00:00Z"), new Date("2026-11-10T01:30:00Z"))).toBe(1.5);
  });
});

describe("reauthorization replay", () => {
  it("uses one fixed request ID per authorization", () => {
    expect(reauthRequestId("A1")).toBe("s06b-reauth-A1");
  });

  it("gives later attempts their own request ID", () => {
    expect(reauthRequestId("A1", 2)).toBe("s06b-reauth-A1-a2");
    expect(() => reauthRequestId("A1", 0)).toThrow();
  });

  it("recognises the first reauthorization", () => {
    expect(compareReauthReplay("A2", { outcome: "succeeded", authorizationId: "A2" })).toBe("returned_original");
  });

  it("flags a second reauthorization", () => {
    expect(compareReauthReplay("A2", { outcome: "succeeded", authorizationId: "A3" })).toBe("new_authorization");
  });

  it("treats errors and unknowns as not returned", () => {
    expect(compareReauthReplay("A2", { outcome: "unknown", reason: "unrecognized_error" })).toBe("not_returned");
    expect(compareReauthReplay("A2", { outcome: "failed", code: "X" })).toBe("not_returned");
  });
});

describe("summarizeAuthorization", () => {
  it("keeps only ID, status, amount and expiry on success", () => {
    const summary = summarizeAuthorization({
      outcome: "succeeded",
      httpStatus: 201,
      data: { id: "A2", status: "CREATED", amount: usd("51.00"), expiration_time: "2026-12-09T07:46:40Z", payer: { email: "x" } },
    });
    expect(summary).toEqual({
      outcome: "succeeded",
      authorizationId: "A2",
      status: "CREATED",
      amount: "51.00",
      expiresAt: "2026-12-09T07:46:40Z",
      httpStatus: 201,
      debugId: undefined,
    });
  });
});

describe("extractIssue", () => {
  it("reads the error name and first issue", () => {
    const body = JSON.stringify({
      name: "UNPROCESSABLE_ENTITY",
      details: [{ issue: "REAUTHORIZATION_TOO_SOON", description: "Too soon." }],
      debug_id: "dbg",
    });
    expect(extractIssue(body)).toEqual({
      name: "UNPROCESSABLE_ENTITY",
      issue: "REAUTHORIZATION_TOO_SOON",
      description: "Too soon.",
    });
  });

  it("returns nothing for success or unreadable bodies", () => {
    expect(extractIssue(undefined)).toBeUndefined();
    expect(extractIssue("not json")).toBeUndefined();
    expect(extractIssue('{"id":"A2","status":"CREATED"}')).toBeUndefined();
  });
});
