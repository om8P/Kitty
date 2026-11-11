import { handle } from "@/server/http";
import { clearSessionCookie } from "@/server/session";

/** Leaves the demo household. Its pools stay in the database but are no longer reachable. */
export async function POST(request: Request) {
  return handle(request, async () => {
    await clearSessionCookie();
    return Response.json({ ok: true });
  });
}
