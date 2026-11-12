/**
 * The tick (plan step S41a, architecture 2 and 8). A GitHub Actions schedule
 * calls it every 5 minutes, and it may be delayed, skipped or run twice, so
 * every job is safe to repeat: each change is guarded by the status it
 * expects, and no lock is held across a PayPal call.
 *
 * Jobs here recover work a restart or a lost answer left behind. Hold
 * refresh, term expiry, the product purge, unmatched webhooks and
 * reconciliation come in S41b, S42, S44 and S45.
 */
import { failStaleAgentRuns } from "@/ai/agent";
import { abandonStalePools } from "@/domain/pools";
import type { Database } from "@/domain/ports";
import { APPROVAL_TTL_MS, expireWaitingApprovals, replayCapture, type PurchaseDeps } from "@/domain/purchases";
import type { PurchaseRow } from "@/domain/types";

export type TickDeps = { db: Database; purchases: PurchaseDeps; now?: () => Date };

export type TickReport = {
  /** How many records each job moved. */
  jobs: Record<JobName, number>;
  /** Jobs that threw. The others still ran. */
  failed: JobName[];
};

type JobName =
  | "staleReviews"
  | "staleCaptures"
  | "replayedCaptures"
  | "stoppedReplays"
  | "expiredApprovals"
  | "abandonedPools"
  | "staleAgentRuns";

/** A review that hasn't finished in this long was cut off by a restart. */
export const STALE_REVIEW_MINUTES = 5;
/** PayPal answers a capture within its 15-second timeout, so a capture this old was cut off. */
export const STALE_CAPTURE_MINUTES = 2;
/** S05 proved PayPal replays a capture's original result for at least an hour (architecture 7.2). */
export const REPLAY_WINDOW_MS = 60 * 60_000;
const REPLAY_BATCH = 20;

export async function runTick(deps: TickDeps): Promise<TickReport> {
  const now = (deps.now ?? (() => new Date()))();
  const report: TickReport = {
    jobs: {
      staleReviews: 0,
      staleCaptures: 0,
      replayedCaptures: 0,
      stoppedReplays: 0,
      expiredApprovals: 0,
      abandonedPools: 0,
      staleAgentRuns: 0,
    },
    failed: [],
  };
  const run = async (name: JobName, job: () => Promise<number>) => {
    try {
      report.jobs[name] += await job();
    } catch (error) {
      report.failed.push(name);
      console.error(`tick job ${name} failed`, error instanceof Error ? error.name : "unknown");
    }
  };

  await run("staleReviews", () => sendStaleReviewsToOwner(deps.db, now));
  await run("staleCaptures", () => markStaleCapturesUnknown(deps.db, now));
  await run("replayedCaptures", async () => {
    const { replayed, stopped } = await replayUnknownCaptures(deps, now);
    report.jobs.stoppedReplays += stopped;
    return replayed;
  });
  await run("expiredApprovals", () => expireWaitingApprovals(deps.db, now));
  await run("abandonedPools", () => abandonStalePools(deps.db, now));
  await run("staleAgentRuns", () => failStaleAgentRuns(deps.db, { now }));
  return report;
}

/**
 * The process died during review. The purchase goes to the owner, as any AI
 * failure does (architecture 8). No money was reserved, so none moves.
 */
async function sendStaleReviewsToOwner(db: Database, now: Date): Promise<number> {
  const moved = await db.query<{ id: string }>(
    `UPDATE purchases SET status = 'awaiting_approval',
       approval_reason = CASE WHEN ai_decision IS NULL THEN 'AI review unavailable' ELSE 'Kitty stopped before paying' END,
       ai_decision = COALESCE(ai_decision, 'unavailable'),
       ai_reason = COALESCE(ai_reason, 'The AI review didn''t finish.'),
       approval_expires_at = $1::timestamptz + $2 * interval '1 millisecond',
       updated_at = now()
     WHERE status = 'reviewing' AND updated_at < $1::timestamptz - interval '${STALE_REVIEW_MINUTES} minutes'
     RETURNING id`,
    [now, APPROVAL_TTL_MS],
  );
  return moved.length;
}

/** The process died during capture. The outcome is unknown, so the funds stay reserved (architecture 7.2). */
async function markStaleCapturesUnknown(db: Database, now: Date): Promise<number> {
  const moved = await db.query<{ id: string }>(
    `UPDATE purchases SET status = 'capture_unknown',
       message = 'PayPal has not confirmed this payment yet. The money stays set aside.', updated_at = now()
     WHERE status = 'capturing' AND updated_at < $1::timestamptz - interval '${STALE_CAPTURE_MINUTES} minutes'
     RETURNING id`,
    [now],
  );
  return moved.length;
}

/**
 * Replays each unknown capture with its own request ID, so PayPal returns the
 * original result and never charges twice. Past the window S05 proved, it
 * stops sending and flags the purchase for a check by hand instead; the
 * money stays reserved until then.
 */
async function replayUnknownCaptures(deps: TickDeps, now: Date): Promise<{ replayed: number; stopped: number }> {
  const waiting = await deps.db.query<PurchaseRow & { reserved_at: Date | null }>(
    `SELECT p.*, (SELECT min(l.created_at) FROM ledger_entries l WHERE l.purchase_id = p.id AND l.kind = 'reserve') AS reserved_at
     FROM purchases p
     WHERE p.status = 'capture_unknown' AND NOT p.needs_attention
     ORDER BY p.updated_at LIMIT ${REPLAY_BATCH}`,
  );
  let replayed = 0;
  let stopped = 0;
  for (const purchase of waiting) {
    const reservedAt = purchase.reserved_at ? new Date(purchase.reserved_at).getTime() : now.getTime();
    if (now.getTime() - reservedAt > REPLAY_WINDOW_MS) {
      await deps.db.query(
        `UPDATE purchases SET needs_attention = true, updated_at = now(),
           message = 'PayPal still hasn''t confirmed this payment after an hour. The money stays set aside until it''s checked by hand.'
         WHERE id = $1 AND status = 'capture_unknown'`,
        [purchase.id],
      );
      stopped += 1;
      continue;
    }
    // One purchase failing to replay doesn't stop the others.
    try {
      await replayCapture(deps.purchases, purchase);
      replayed += 1;
    } catch (error) {
      console.error("tick replay failed", error instanceof Error ? error.name : "unknown");
    }
  }
  return { replayed, stopped };
}
