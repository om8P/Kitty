/**
 * The app-wide daily AI budget, kept in `usage_counters` so it survives a
 * restart (architecture 2.1 and 3). Both caps sit below Groq's free limits of
 * 1,000 requests and 200,000 tokens a day. Groq's own token count runs higher
 * than `usage` reports (S10), so the token cap leaves a wide margin.
 *
 * The per-household caps and the AI-off switch come with S49.
 */
import type { Database } from "@/domain/ports";
import type { UsageBudget } from "./model";

export const AI_DAILY_REQUEST_CAP = 800;
export const AI_DAILY_TOKEN_CAP = 150_000;

export function createUsageBudget(
  db: Database,
  options: { requestCap?: number; tokenCap?: number; now?: () => Date } = {},
): UsageBudget {
  const requestCap = options.requestCap ?? AI_DAILY_REQUEST_CAP;
  const tokenCap = options.tokenCap ?? AI_DAILY_TOKEN_CAP;
  const period = () => (options.now ?? (() => new Date()))().toISOString().slice(0, 10);

  return {
    async allow() {
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
