import { z } from "zod";
import { parseDollars } from "@/domain/money";
import { createPool, type NewMember } from "@/domain/pools";
import { DomainError } from "@/domain/types";
import { getContainer } from "@/server/container";
import { baseUrl, handle, readJson } from "@/server/http";
import { requireSession } from "@/server/session";

const memberSchema = z.object({
  kind: z.enum(["person", "agent"]),
  limit: z.string().max(20),
  threshold: z.string().max(20),
  stores: z.array(z.string().max(40)).max(10),
});

const bodySchema = z.object({
  goal: z.string().max(200),
  amount: z.string().max(20),
  termDays: z.number().int(),
  members: z.array(memberSchema).min(1).max(2),
});

/** Creates a pool and its PayPal order, and returns the PayPal approval link. */
export async function POST(request: Request) {
  return handle(request, async () => {
    const { db, rail } = await getContainer();
    const session = await requireSession(db);
    if (session.user.role !== "owner") {
      throw new DomainError("forbidden", `Only the owner can create a pool. You're signed in as ${session.user.name}.`);
    }
    const body = bodySchema.safeParse(await readJson(request));
    if (!body.success) throw new DomainError("invalid", "Some pool details are missing. Check the form and try again.");

    const amountCents = parseDollars(body.data.amount);
    if (amountCents === null) throw new DomainError("invalid", "Enter the pool amount in dollars, for example 150.");

    const teen = session.users.find((user) => user.role === "member");
    const members: NewMember[] = body.data.members.map((member) => {
      const label = member.kind === "agent" ? "Shopping agent" : (teen?.name ?? "Family member");
      const limitCents = parseDollars(member.limit);
      const thresholdCents = parseDollars(member.threshold);
      if (limitCents === null) throw new DomainError("invalid", `Enter ${label}'s limit in dollars, for example 40.`);
      if (thresholdCents === null) {
        throw new DomainError("invalid", `Enter ${label}'s approval amount in dollars, for example 15.`);
      }
      return {
        kind: member.kind,
        userId: member.kind === "person" ? (teen?.id ?? null) : null,
        label,
        limitCents,
        approvalThresholdCents: thresholdCents,
        allowedStores: member.stores,
      };
    });
    if (new Set(members.map((member) => member.kind)).size !== members.length) {
      throw new DomainError("invalid", "Each member can be added once.");
    }

    const origin = baseUrl(request);
    const { pool, approvalUrl } = await createPool(
      { db, rail },
      {
        householdId: session.householdId,
        ownerUserId: session.user.id,
        goal: body.data.goal,
        amountCents,
        termDays: body.data.termDays,
        members,
      },
      { returnUrl: `${origin}/api/paypal/return`, cancelUrl: `${origin}/api/paypal/cancel` },
    );
    return Response.json({ poolId: pool.id, approvalUrl });
  });
}
