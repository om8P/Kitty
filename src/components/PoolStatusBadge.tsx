import type { PoolView } from "@/lib/views";
import { ToneBadge } from "./StatusBadge";

export function PoolStatusBadge({ pool }: { pool: PoolView }) {
  if (pool.status === "active") return <ToneBadge tone="ok">Open</ToneBadge>;
  if (pool.status === "awaiting_payer") return <ToneBadge tone="warn">Awaiting approval</ToneBadge>;
  if (pool.status === "closing") return <ToneBadge tone="warn">Closing</ToneBadge>;
  return <ToneBadge tone="neutral">Closed</ToneBadge>;
}
