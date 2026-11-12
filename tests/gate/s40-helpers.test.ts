import { describe, expect, it } from "vitest";
import { compareIntegrity, offGoalPassed, ruleBreakerPassed } from "../../scripts/gate/s40-helpers";

describe("compareIntegrity", () => {
  it("matches when PayPal's captures equal Kitty's captured total, refunded ones included", () => {
    const result = compareIntegrity(
      389 + 299,
      ["a", "b"],
      [
        { status: "COMPLETED", amountValue: "3.89", invoiceId: "kitty-a" },
        { status: "REFUNDED", amountValue: "2.99", invoiceId: "kitty-b" },
      ],
    );
    expect(result).toEqual({
      paypalCapturedCents: 688,
      paypalCaptureCount: 2,
      kittyCapturedCents: 688,
      unmatched: 0,
      match: true,
    });
  });

  it("ignores captures that moved no money", () => {
    const result = compareIntegrity(389, ["a"], [
      { status: "COMPLETED", amountValue: "3.89", invoiceId: "kitty-a" },
      { status: "DECLINED", amountValue: "9.00", invoiceId: "kitty-x" },
    ]);
    expect(result.match).toBe(true);
    expect(result.paypalCaptureCount).toBe(1);
  });

  it("fails on a total mismatch", () => {
    expect(compareIntegrity(500, ["a"], [{ status: "COMPLETED", amountValue: "3.89", invoiceId: "kitty-a" }]).match).toBe(
      false,
    );
  });

  it("fails when a capture names no purchase of the pool, even if totals agree", () => {
    const result = compareIntegrity(389, ["a"], [{ status: "COMPLETED", amountValue: "3.89", invoiceId: "kitty-other" }]);
    expect(result.unmatched).toBe(1);
    expect(result.match).toBe(false);
  });

  it("fails when PayPal shows two captures for one purchase (a double charge)", () => {
    const result = compareIntegrity(389, ["a"], [
      { status: "COMPLETED", amountValue: "3.89", invoiceId: "kitty-a" },
      { status: "COMPLETED", amountValue: "3.89", invoiceId: "kitty-a" },
    ]);
    expect(result.match).toBe(false);
  });
});

describe("scenario verdicts", () => {
  it("passes a rule breaker only when the rules stopped it before any AI decision", () => {
    expect(ruleBreakerPassed({ status: "rejected_by_rules", ruleCode: "store_not_allowed", aiDecision: null }, "store_not_allowed")).toBe(true);
    expect(ruleBreakerPassed({ status: "rejected_by_rules", ruleCode: "store_not_allowed", aiDecision: "block" }, "store_not_allowed")).toBe(false);
    expect(ruleBreakerPassed({ status: "rejected_by_rules", ruleCode: "over_member_limit", aiDecision: null }, "store_not_allowed")).toBe(false);
    expect(ruleBreakerPassed({ status: "captured", ruleCode: null, aiDecision: "allow" }, "store_not_allowed")).toBe(false);
  });

  it("passes an off-goal purchase only when the AI flagged or blocked it", () => {
    expect(offGoalPassed("blocked_by_ai", "block")).toBe(true);
    expect(offGoalPassed("awaiting_approval", "flag")).toBe(true);
    expect(offGoalPassed("awaiting_approval", "unavailable")).toBe(false);
    expect(offGoalPassed("captured", "allow")).toBe(false);
  });
});
