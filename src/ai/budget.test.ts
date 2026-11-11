/**
 * S28: the daily AI budget lives in `usage_counters` on real Postgres, so it
 * holds across a restart and fails safe when the count can't be read.
 */
import { describe, expect, it } from "vitest";
import { openTestDatabase } from "@/db/testing";
import type { Database } from "@/domain/ports";
import { AI_DAILY_REQUEST_CAP, AI_DAILY_TOKEN_CAP, createUsageBudget } from "./budget";

const day = (iso: string) => () => new Date(iso);

describe("daily AI budget", () => {
  it("keeps both caps below Groq's free limits", () => {
    expect(AI_DAILY_REQUEST_CAP).toBeLessThan(1_000);
    expect(AI_DAILY_TOKEN_CAP).toBeLessThan(200_000);
  });

  it("allows requests up to the cap, then refuses", async () => {
    const db = await openTestDatabase();
    const budget = createUsageBudget(db, { requestCap: 2, now: day("2026-11-11T10:00:00Z") });
    expect([await budget.allow(), await budget.allow(), await budget.allow()]).toEqual([true, true, false]);
  });

  it("refuses once the day's tokens reach the cap", async () => {
    const db = await openTestDatabase();
    const budget = createUsageBudget(db, { tokenCap: 1_000, now: day("2026-11-11T10:00:00Z") });
    await budget.record(600);
    expect(await budget.allow()).toBe(true);
    await budget.record(400);
    expect(await budget.allow()).toBe(false);
  });

  it("survives a restart: a new budget on the same database sees the same counts", async () => {
    const db = await openTestDatabase();
    const now = day("2026-11-11T10:00:00Z");
    const before = createUsageBudget(db, { requestCap: 1, now });
    expect(await before.allow()).toBe(true);
    await before.record(500);

    // The request cap carries over.
    expect(await createUsageBudget(db, { requestCap: 1, now }).allow()).toBe(false);
    // So does the token count: a budget whose token cap is already used refuses.
    expect(await createUsageBudget(db, { tokenCap: 500, now }).allow()).toBe(false);

    const rows = await db.query<{ kind: string; count: number }>(
      "SELECT kind, count FROM usage_counters WHERE period = '2026-11-11' ORDER BY kind",
    );
    expect(rows).toEqual([
      { kind: "ai_request", count: 2 },
      { kind: "ai_tokens", count: 500 },
    ]);
  });

  it("starts again each UTC day", async () => {
    const db = await openTestDatabase();
    const today = createUsageBudget(db, { requestCap: 1, now: day("2026-11-11T23:59:00Z") });
    expect(await today.allow()).toBe(true);
    expect(await today.allow()).toBe(false);
    const tomorrow = createUsageBudget(db, { requestCap: 1, now: day("2026-11-12T00:01:00Z") });
    expect(await tomorrow.allow()).toBe(true);
  });

  it("fails safe when the database can't be read", async () => {
    const broken: Database = {
      query: async () => {
        throw new Error("connection lost");
      },
      transaction: async () => {
        throw new Error("connection lost");
      },
    };
    expect(await createUsageBudget(broken).allow()).toBe(false);
  });

  it("ignores token counts that aren't positive whole numbers", async () => {
    const db = await openTestDatabase();
    const budget = createUsageBudget(db, { now: day("2026-11-11T10:00:00Z") });
    await budget.record(0);
    await budget.record(-5);
    await budget.record(1.5);
    expect(await db.query("SELECT * FROM usage_counters WHERE kind = 'ai_tokens'")).toEqual([]);
  });
});
