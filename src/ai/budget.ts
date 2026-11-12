/**
 * The app-wide daily AI budget, kept in `usage_counters` so it survives a
 * restart (architecture 2.1 and 3). Both caps sit below Groq's free limits of
 * 1,000 requests and 200,000 tokens a day. Groq's own token count runs higher
 * than `usage` reports (S10), so the token cap leaves a wide margin.
 *
 * S49 adds the per-household caps (`createAiQuota`) and the AI-off switch
 * (`AI_ENABLED`). With AI off every request is refused, so reviews count as
 * unavailable and purchases go to the owner (architecture Security).
 */
import type { AiAllowance, AiQuota, Database } from "@/domain/ports";
import type { UsageBudget } from "./model";

export const AI_DAILY_REQUEST_CAP = 800;
export const AI_DAILY_TOKEN_CAP = 150_000;
/** Per household per UTC day, set for a shared judge demo (S49). */
export const HOUSEHOLD_DAILY_REVIEW_CAP = 40;
export const HOUSEHOLD_DAILY_AGENT_RUN_CAP = 5;

type Env = Record<string, string | undefined>;

/** AI is on unless `AI_ENABLED` is set to off, false, 0 or no. */
export function aiEnabled(env: Env = process.env): boolean {
  const value = env.AI_ENABLED?.trim().toLowerCase();
  return !value || !["off", "false", "0", "no"].includes(value);
}

export function createUsageBudget(
  db: Database,
  options: { requestCap?: number; tokenCap?: number; now?: () => Date; env?: Env } = {},
): UsageBudget {
  const env = options.env ?? process.env;
  const requestCap = options.requestCap ?? AI_DAILY_REQUEST_CAP;
  const tokenCap = options.tokenCap ?? AI_DAILY_TOKEN_CAP;
  const period = () => (options.now ?? (() => new Date()))().toISOString().slice(0, 10);

  return {
    async allow() {
      // Read on every call, so the switch needs no restart in tests or scripts.
      if (!aiEnabled(env)) return false;
      try {
        const day = period();
        const [tokens] = await db.query<{ count: number }>(
          "SELECT count FROM usage_counters WHERE kind = 'ai_tokens' AND period = $1",
          [day],
        );
        if ((tokens?.count ?? 0) >= tokenCap) return false;
        const [requests] = await db.query<{ count: number }>(
          `INSERT INTO usage_counters (kind, period, count) VALUES ('ai_request', $1, 1)
           ON CONFLICT (kind, period) DO UPDATE SET count = usage_counters.count + 1
           RETURNING count`,
          [day],
        );
        return requests.count <= requestCap;
      } catch {
        // If the count can't be read, fail safe: the purchase goes to the owner.
        return false;
      }
    },
    async record(tokens) {
      if (!Number.isInteger(tokens) || tokens <= 0) return;
      await db.query(
        `INSERT INTO usage_counters (kind, period, count) VALUES ('ai_tokens', $1, $2)
         ON CONFLICT (kind, period) DO UPDATE SET count = usage_counters.count + $2`,
        [period(), tokens],
      );
    },
  };
}

/**
 * Per-household daily caps on AI reviews and agent runs, counted in
 * `usage_counters` so they hold across a restart. A count that can't be
 * written answers `limit`, so the purchase goes to the owner.
 */
export function createAiQuota(
  db: Database,
  options: { reviewCap?: number; agentRunCap?: number; now?: () => Date; env?: Env } = {},
): AiQuota {
  const env = options.env ?? process.env;
  const reviewCap = options.reviewCap ?? HOUSEHOLD_DAILY_REVIEW_CAP;
  const agentRunCap = options.agentRunCap ?? HOUSEHOLD_DAILY_AGENT_RUN_CAP;
  const period = () => (options.now ?? (() => new Date()))().toISOString().slice(0, 10);

  async function take(kind: string, cap: number): Promise<AiAllowance> {
    if (!aiEnabled(env)) return "off";
    try {
      const [row] = await db.query<{ count: number }>(
        `INSERT INTO usage_counters (kind, period, count) VALUES ($1, $2, 1)
         ON CONFLICT (kind, period) DO UPDATE SET count = usage_counters.count + 1
         RETURNING count`,
        [kind, period()],
      );
      return row.count <= cap ? "ok" : "limit";
    } catch {
      return "limit";
    }
  }

  return {
    takeReview: (householdId) => take(`household_review:${householdId}`, reviewCap),
    takeAgentRun: (householdId) => take(`household_agent_run:${householdId}`, agentRunCap),
  };
}
