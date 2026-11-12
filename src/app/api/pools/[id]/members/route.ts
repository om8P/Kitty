import { addMember } from "@/domain/members";
import { loadHouseholdPool } from "@/server/api";
import { getContainer } from "@/server/container";
import { handle } from "@/server/http";
import { addSchema, memberResponse, readRules } from "@/server/members";
import { requireSession } from "@/server/session";

/** Adds the family member or the shopping agent, or switches a removed one back on. Owner only. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(request, async () => {
    const { id } = await context.params;
    const { db } = await getContainer();
    const session = await requireSession(db);
    const pool = await loadHouseholdPool(db, session, id);
    const { body, rules } = await readRules(request, addSchema);
    // A person is always the household's own family member, never one the browser names.
    const teen = session.users.find((user) => user.role === "member");
    const member = await addMember(db, {
      poolId: pool.id,
      userId: session.user.id,
      kind: body.kind,
      memberUserId: body.kind === "person" ? (teen?.id ?? null) : null,
      label: body.kind === "agent" ? "Shopping agent" : (teen?.name ?? "Family member"),
      rules,
    });
    return memberResponse(member);
  });
}
