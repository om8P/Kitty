import type { PurchaseStatus } from "@/domain/types";
import { STATUS_LABELS, type Tone } from "@/lib/labels";

const TONE_CLASS: Record<Tone, string> = {
  ok: "badge badge--ok",
  warn: "badge badge--warn",
  stop: "badge badge--stop",
  neutral: "badge",
};

/** A status is always a color and a word together, never color alone. */
export function StatusBadge({ status }: { status: PurchaseStatus }) {
  const { label, tone } = STATUS_LABELS[status];
  return <span className={TONE_CLASS[tone]}>{label}</span>;
}

export function ToneBadge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={TONE_CLASS[tone]}>{children}</span>;
}
