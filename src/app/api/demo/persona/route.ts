import { z } from "zod";
import { DomainError } from "@/domain/types";
import { getContainer } from "@/server/container";
import { handle, readJson } from "@/server/http";
import { requireSession, setSessionCookie } from "@/server/session";

const bodySchema = z.object({ userId: z.string().min(1).max(64) });

/** Switches the current persona to another user in the same household. */
export async function POST(request: Request) {
  return handle(request, async () => {
    const { db } = await getContainer();
    const session = await requireSession(db);
    const body = bodySchema.safeParse(await readJson(request));
    const target = body.success ? session.users.find((user) => user.id === body.data.userId) : undefined;
    if (!target) throw new DomainError("not_found", "That person isn't in this household.");
    await setSessionCookie({ householdId: session.householdId, userId: target.id });
    return Response.json({ ok: true, role: target.role });
  });
}
