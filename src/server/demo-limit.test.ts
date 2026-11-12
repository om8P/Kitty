/** S51: the daily cap on new demo households, on real Postgres. */
import { describe, expect, it } from "vitest";
import { openTestDatabase } from "@/db/testing";
import type { Database } from "@/domain/ports";
import { DEMO_HOUSEHOLDS_PER_DAY, takeDemoHousehold } from "./demo-limit";

describe("demo household cap", () => {
  it("allows households up to the day's cap, then refuses until the next UTC day", async () => {
    const db = await openTestDatabase();
    const now = new Date("2026-11-12T23:00:00Z");
    expect([await takeDemoHousehold(db, { cap: 2, now }), await takeDemoHousehold(db, { cap: 2, now })]).toEqual([true, true]);
    expect(await takeDemoHousehold(db, { cap: 2, now })).toBe(false);
    expect(await takeDemoHousehold(db, { cap: 2, now: new Date("2026-11-13T00:01:00Z") })).toBe(true);
  });

  it("refuses when the count can't be written, and leaves room for a busy judging day", async () => {
    const broken = { query: async () => { throw new Error("database down"); } } as unknown as Database;
    expect(await takeDemoHousehold(broken)).toBe(false);
    expect(DEMO_HOUSEHOLDS_PER_DAY).toBeGreaterThanOrEqual(100);
  });
});
