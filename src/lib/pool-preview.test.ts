/** The live preview on the Create a pool screen (the owner's N6 request). */
import { describe, expect, it } from "vitest";
import { poolPreview } from "./pool-preview";

const teen = { name: "Sam", kind: "person" as const, limit: "40", threshold: "15" };
const agent = { name: "Shopping agent", kind: "agent" as const, limit: "80", threshold: "25" };

describe("poolPreview", () => {
  it("shows each limit against the amount, and the money in no one's limit", () => {
    const preview = poolPreview({ amount: "150", members: [teen, agent] });
    expect(preview).toMatchObject({ ready: true, amountCents: 150_00, limitsCents: 120_00, unassignedCents: 30_00, shared: false });
    if (!preview.ready) throw new Error("expected a ready preview");
    expect(preview.spenders.map((s) => [s.limitCents, s.thresholdCents, Math.round(s.percent ?? -1), s.overPool])).toEqual([
      [40_00, 15_00, 27, false],
      [80_00, 25_00, 53, false],
    ]);
  });

  it("says spenders share the pool when their limits add up to more than it", () => {
    const preview = poolPreview({ amount: "100", members: [{ ...teen, limit: "60" }, { ...agent, limit: "70" }] });
    expect(preview).toMatchObject({ ready: true, limitsCents: 130_00, unassignedCents: 0, shared: true });
  });

  it("caps the bar at the full pool and marks a limit above the pool", () => {
    const preview = poolPreview({ amount: "50", members: [{ ...teen, limit: "75" }] });
    expect(preview.spenders[0]).toMatchObject({ percent: 100, overPool: true });
  });

  it("isn't ready until the amount is a valid $5 to $500, and keeps the spenders' rows", () => {
    for (const amount of ["", "abc", "4.99", "500.01"]) {
      const preview = poolPreview({ amount, members: [teen] });
      expect(preview.ready).toBe(false);
      expect(preview.spenders[0]).toMatchObject({ limitCents: 40_00, percent: null, overPool: false });
    }
    expect(poolPreview({ amount: "5", members: [] }).ready).toBe(true);
    expect(poolPreview({ amount: "500", members: [] }).ready).toBe(true);
  });

  it("leaves an unreadable or zero limit and threshold out of the totals", () => {
    const preview = poolPreview({ amount: "150", members: [{ ...teen, limit: "0", threshold: "x" }, agent] });
    expect(preview).toMatchObject({ ready: true, limitsCents: 80_00 });
    expect(preview.spenders[0]).toMatchObject({ limitCents: null, thresholdCents: null, percent: null });
  });
});
