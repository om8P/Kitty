/**
 * S49: per-household AI caps and the AI-off switch (architecture Security,
 * "AI quota"). Counts live in `usage_counters` on real Postgres, so they hold
 * across a restart. A household at its cap, or AI switched off, never blocks a
 * purchase by itself: the review counts as unavailable and the owner decides.
 */
import { describe, expect, it } from "vitest";
import { createCatalog } from "@/adapters/catalog/catalog";
import { submitPurchase } from "@/domain/purchases";
import { createWorld } from "@/domain/testing";
import { startAgentRun } from "./agent";
import { aiEnabled, createAiQuota, createUsageBudget, HOUSEHOLD_DAILY_AGENT_RUN_CAP, HOUSEHOLD_DAILY_REVIEW_CAP } from "./budget";
import { createGroqModel } from "./model";

const now = () => new Date("2026-11-12T10:00:00Z");
let keys = 0;

describe("AI-off switch", () => {
  it("is on by default and off for off, false, 0 and no", () => {
    expect(aiEnabled({})).toBe(true);
    expect(aiEnabled({ AI_ENABLED: "" })).toBe(true);
    expect(aiEnabled({ AI_ENABLED: "on" })).toBe(true);
    for (const value of ["off", "false", "0", "no", " OFF "]) expect(aiEnabled({ AI_ENABLED: value })).toBe(false);
  });

  it("makes the app-wide budget refuse every request, so the model never calls Groq", async () => {
    const world = await createWorld();
    const budget = createUsageBudget(world.db, { now, env: { AI_ENABLED: "off" } });
    expect(await budget.allow()).toBe(false);

    let calls = 0;
    const model = createGroqModel(
      { GROQ_API_KEY: "test-key" },
      { budget, fetch: (async () => { calls++; throw new Error("no network in tests"); }) as typeof fetch },
    );
    expect(await model.chat({ messages: [{ role: "user", content: "hi" }] })).toEqual({ ok: false, reason: "quota" });
    expect(calls).toBe(0);
  });
});

describe("household AI quota", () => {
  it("keeps the shared-demo caps small and below the app-wide cap", () => {
    expect(HOUSEHOLD_DAILY_REVIEW_CAP).toBeLessThan(800);
    expect(HOUSEHOLD_DAILY_AGENT_RUN_CAP).toBeLessThanOrEqual(HOUSEHOLD_DAILY_REVIEW_CAP);
  });

  it("allows each household up to its cap, separately, and survives a restart", async () => {
    const world = await createWorld();
    const quota = createAiQuota(world.db, { reviewCap: 2, agentRunCap: 1, now, env: {} });
    expect([await quota.takeReview("h1"), await quota.takeReview("h1"), await quota.takeReview("h1")]).toEqual([
      "ok",
      "ok",
      "limit",
    ]);
    expect(await quota.takeReview("h2")).toBe("ok");
    expect([await quota.takeAgentRun("h1"), await quota.takeAgentRun("h1")]).toEqual(["ok", "limit"]);

    // A new quota on the same database, as after a restart, sees the same counts.
    const restarted = createAiQuota(world.db, { reviewCap: 2, agentRunCap: 1, now, env: {} });
    expect(await restarted.takeReview("h1")).toBe("limit");
    // The next UTC day starts again.
    const tomorrow = createAiQuota(world.db, { reviewCap: 2, now: () => new Date("2026-11-13T00:01:00Z"), env: {} });
    expect(await tomorrow.takeReview("h1")).toBe("ok");
  });

  it("answers off when AI is switched off, and limit when the count can't be written", async () => {
    const world = await createWorld();
    expect(await createAiQuota(world.db, { env: { AI_ENABLED: "off" } }).takeReview("h1")).toBe("off");
    const broken = { ...world.db, query: async () => { throw new Error("database down"); } } as typeof world.db;
    expect(await createAiQuota(broken, { env: {} }).takeReview("h1")).toBe("limit");
  });
});

describe("purchases and agent runs under the quota", () => {
  it("sends a purchase to the owner without calling the reviewer once the household is at its cap", async () => {
    const world = await createWorld();
    const quota = createAiQuota(world.db, { reviewCap: 1, now, env: {} });
    const deps = { ...world.deps, quota };
    const productId = await world.addProduct({ priceCents: 5_00 });
    const buy = () =>
      submitPurchase(deps, { poolId: world.pool.id, memberId: world.teen.id, productId, quantity: 1, idempotencyKey: `q-${keys++}` });

    expect((await buy()).status).toBe("captured");
    const second = await buy();
    expect(second.status).toBe("awaiting_approval");
    expect(second.ai_decision).toBe("unavailable");
    expect(second.ai_reason).toMatch(/used today's AI reviews/);
    expect(world.reviewer.calls).toHaveLength(1);
  });

  it("sends every purchase to the owner when AI is switched off", async () => {
    const world = await createWorld();
    const deps = { ...world.deps, quota: createAiQuota(world.db, { env: { AI_ENABLED: "off" } }) };
    const purchase = await submitPurchase(deps, {
      poolId: world.pool.id,
      memberId: world.teen.id,
      productId: await world.addProduct({ priceCents: 5_00 }),
      quantity: 1,
      idempotencyKey: `q-${keys++}`,
    });
    expect(purchase.status).toBe("awaiting_approval");
    expect(purchase.ai_reason).toMatch(/switched off/);
    expect(world.reviewer.calls).toHaveLength(0);
  });

  it("refuses an agent run past the household's daily runs, or with AI off", async () => {
    const world = await createWorld();
    await createCatalog(world.db, {}).featured();
    const quota = createAiQuota(world.db, { agentRunCap: 1, now, env: {} });
    const start = (q = quota) =>
      startAgentRun(world.db, { poolId: world.pool.id, userId: world.owner.id, task: "Buy pasta for dinner" }, q);

    const run = await start();
    // A second start while the first is open is refused without using a run.
    await expect(start()).rejects.toThrow(/already shopping/);
    await world.db.query("UPDATE agent_runs SET status = 'finished', finished_at = now() WHERE id = $1", [run.id]);
    await expect(start()).rejects.toThrow(/used today's agent runs/);
    await expect(start(createAiQuota(world.db, { env: { AI_ENABLED: "off" } }))).rejects.toThrow(/switched off/);
  });
});
