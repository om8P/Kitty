import { createHash, timingSafeEqual } from "node:crypto";
import { runTick } from "@/jobs/tick";
import { getContainer } from "@/server/container";

export const dynamic = "force-dynamic";

const ticking = globalThis as typeof globalThis & { __kittyTickRunning?: boolean };

/**
 * The scheduled tick (S41a). Called by `.github/workflows/schedule.yml` with
 * `Authorization: Bearer <CRON_SECRET>`. With no secret configured, every call
 * is refused, so the tick can never run unauthenticated.
 */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return Response.json({ error: "The tick is off until CRON_SECRET is set." }, { status: 503 });
  if (!bearerMatches(request.headers.get("authorization"), secret)) {
    return Response.json({ error: "Not allowed." }, { status: 401 });
  }
  // Schedules can overlap. A second call while one runs has nothing to add.
  if (ticking.__kittyTickRunning) return Response.json({ skipped: "A tick is already running." });

  ticking.__kittyTickRunning = true;
  try {
    const { db, purchases } = await getContainer();
    const report = await runTick({ db, purchases });
    // A failed job fails the scheduled run, so it shows in the Actions log.
    return Response.json(report, { status: report.failed.length > 0 ? 500 : 200 });
  } catch (error) {
    console.error("tick failed", error instanceof Error ? error.name : "unknown");
    return Response.json({ error: "The tick couldn't run." }, { status: 500 });
  } finally {
    ticking.__kittyTickRunning = false;
  }
}

/** Compares in constant time. Hashing first means the secret's length isn't revealed either. */
function bearerMatches(header: string | null, secret: string): boolean {
  const given = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return given.length > 0 && timingSafeEqual(digest(given), digest(secret));
}
