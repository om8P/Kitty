/**
 * The live preview on the Create a pool screen: what the owner is about to
 * hold on PayPal, and how each spender's limit sits against it. A pure
 * function of the form's text fields, so it updates on every keystroke.
 */
import { parseDollars } from "@/domain/money";

export const MIN_POOL_CENTS = 500;
export const MAX_POOL_CENTS = 50_000;

export type PreviewSpender = {
  name: string;
  kind: "person" | "agent";
  limitCents: number | null;
  thresholdCents: number | null;
  /** The limit's share of the pool, 0 to 100. Null when either is unknown. */
  percent: number | null;
  /** True when this limit alone is more than the pool. */
  overPool: boolean;
};

export type PoolPreview =
  | { ready: false; spenders: PreviewSpender[] }
  | {
      ready: true;
      amountCents: number;
      spenders: PreviewSpender[];
      /** Sum of the limits that could be read. */
      limitsCents: number;
      /** Money in no one's limit: the amount minus the limits, never below zero. */
      unassignedCents: number;
      /** Limits add up to more than the pool: spenders share it, first come first served. */
      shared: boolean;
    };

export function poolPreview(input: {
  amount: string;
  members: { name: string; kind: "person" | "agent"; limit: string; threshold: string }[];
}): PoolPreview {
  const parsed = parseDollars(input.amount);
  const amountCents = parsed !== null && parsed >= MIN_POOL_CENTS && parsed <= MAX_POOL_CENTS ? parsed : null;

  const spenders = input.members.map((member): PreviewSpender => {
    const limit = parseDollars(member.limit);
    const limitCents = limit !== null && limit > 0 ? limit : null;
    return {
      name: member.name,
      kind: member.kind,
      limitCents,
      thresholdCents: parseDollars(member.threshold),
      percent: amountCents !== null && limitCents !== null ? Math.min(100, (limitCents / amountCents) * 100) : null,
      overPool: amountCents !== null && limitCents !== null && limitCents > amountCents,
    };
  });

  if (amountCents === null) return { ready: false, spenders };
  const limitsCents = spenders.reduce((sum, spender) => sum + (spender.limitCents ?? 0), 0);
  return {
    ready: true,
    amountCents,
    spenders,
    limitsCents,
    unassignedCents: Math.max(0, amountCents - limitsCents),
    shared: limitsCents > amountCents,
  };
}
