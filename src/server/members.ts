/** Shared parsing for the member routes (plan step S25). The domain checks the rules again. */
import { z } from "zod";
import { parseDollars } from "@/domain/money";
import type { MemberRules } from "@/domain/members";
import { DomainError, type MemberRow } from "@/domain/types";
import { toMemberView } from "@/lib/views";
import { readJson } from "./http";

export const rulesSchema = z.object({
  limit: z.string().max(20),
  threshold: z.string().max(20),
  stores: z.array(z.string().max(40)).max(10),
});

export const addSchema = rulesSchema.extend({ kind: z.enum(["person", "agent"]) });

/** Reads the form's dollar strings and stores into member rules in cents. */
export async function readRules<T extends typeof rulesSchema | typeof addSchema>(
  request: Request,
  schema: T,
): Promise<{ body: z.infer<T>; rules: MemberRules }> {
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) throw new DomainError("invalid", "Some member details are missing. Check the form and try again.");
  const body = parsed.data as z.infer<T>;
  const limitCents = parseDollars(body.limit);
  if (limitCents === null) throw new DomainError("invalid", "Enter the limit in dollars, for example 40.");
  const approvalThresholdCents = parseDollars(body.threshold);
  if (approvalThresholdCents === null) {
    throw new DomainError("invalid", "Enter the approval amount in dollars, for example 15.");
  }
  return { body, rules: { limitCents, approvalThresholdCents, allowedStores: body.stores } };
}

export function memberResponse(member: MemberRow): Response {
  return Response.json({ member: toMemberView(member) });
}
