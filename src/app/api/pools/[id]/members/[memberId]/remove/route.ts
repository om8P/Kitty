import { removeMember } from "@/domain/members";
import { loadHouseholdPool } from "@/server/api";
import { getContainer } from "@/server/container";
import { handle } from "@/server/http";
import { memberResponse } from "@/server/members";
import { requireSession } from "@/server/session";

/** Stops a member from spending. Nothing is deleted. Owner only. */
export async function POST(request: Request, context: { params: Promise<{ id: string; memberId: string }> }) {
  return handle(request, async () => {
    const { id, memberId } = await context.params;
    const { db } = await getContainer();
    const session = await requireSession(db);
    const pool = await loadHouseholdPool(db, session, id);
    const member = await removeMember(db, { poolId: pool.id, memberId, userId: session.user.id });
    return memberResponse(member);
  });
}
