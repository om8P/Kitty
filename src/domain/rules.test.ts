import { describe, expect, it } from "vitest";
import { checkHardRules, finalOutcome, memberRemaining, poolAvailable, type MemberFunds, type PoolFunds } from "./rules";

const now = new Date("2026-11-11T12:00:00Z");

const pool: PoolFunds = {
  status: "active",
  authorizedCents: 150_00,
  reservedCents: 10_00,
  capturedCents: 40_00,
  releasedCents: 0,
  holdExpiresAt: new Date("2026-12-09T00:00:00Z"),
};

const member: MemberFunds = {
  active: true,
  limitCents: 40_00,
  reservedCents: 5_00,
  capturedCents: 10_00,
  approvalThresholdCents: 15_00,
  allowedStores: ["Fresh Market"],
};

const check = (overrides: { pool?: Partial<PoolFunds>; member?: Partial<MemberFunds>; store?: string; amountCents?: number }) =>
  checkHardRules({
    pool: { ...pool, ...overrides.pool },
    member: { ...member, ...overrides.member },
    store: overrides.store ?? "Fresh Market",
    amountCents: overrides.amountCents ?? 10_00,
    now,
  });

describe("balances", () => {
  it("computes what is left in the pool and on a member's limit", () => {
    expect(poolAvailable(pool)).toBe(100_00);
    expect(memberRemaining(member)).toBe(25_00);
  });
});

describe("checkHardRules", () => {
  it("passes a purchase inside every rule", () => {
    expect(check({})).toEqual({ ok: true, needsApproval: false });
  });

  it("needs approval above the member's approval amount, and not at it", () => {
    expect(check({ amountCents: 15_00 })).toEqual({ ok: true, needsApproval: false });
    expect(check({ amountCents: 15_01 })).toEqual({ ok: true, needsApproval: true });
  });

  it("needs approval for every purchase when the approval amount is $0", () => {
    expect(check({ member: { approvalThresholdCents: 0 }, amountCents: 1 })).toEqual({ ok: true, needsApproval: true });
  });

  it.each([
    ["invalid_amount", { amountCents: 0 }],
    ["invalid_amount", { amountCents: 10.5 }],
    ["pool_not_active", { pool: { status: "closing" } }],
    ["pool_not_active", { pool: { status: "awaiting_payer" } }],
    ["hold_expired", { pool: { holdExpiresAt: new Date("2026-11-11T11:59:59Z") } }],
    ["member_inactive", { member: { active: false } }],
    ["store_not_allowed", { store: "Gadget Hub" }],
    ["over_member_limit", { amountCents: 25_01 }],
    ["over_pool_balance", { pool: { capturedCents: 135_00 }, amountCents: 6_00 }],
  ] as const)("stops with %s", (code, overrides) => {
    const result = check(overrides);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(code);
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it("allows spending exactly what is left", () => {
    expect(check({ amountCents: 25_00 }).ok).toBe(true);
  });
});

describe("finalOutcome", () => {
  it("lets AI only tighten the outcome, for every combination", () => {
    expect(finalOutcome(false, "allow")).toBe("capture");
    expect(finalOutcome(true, "allow")).toBe("needs_approval");
    expect(finalOutcome(false, "flag")).toBe("needs_approval");
    expect(finalOutcome(true, "flag")).toBe("needs_approval");
    expect(finalOutcome(false, "unavailable")).toBe("needs_approval");
    expect(finalOutcome(true, "unavailable")).toBe("needs_approval");
    expect(finalOutcome(false, "block")).toBe("blocked");
    expect(finalOutcome(true, "block")).toBe("blocked");
  });
});
