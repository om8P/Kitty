import { formatUsd } from "@/domain/money";

type Props = {
  authorizedCents: number;
  capturedCents: number;
  reservedCents: number;
  availableCents: number;
  releasedCents?: number;
  compact?: boolean;
};

/**
 * Kitty's signature element: one bar showing where a pool's money is.
 * Spent is solid navy, money being paid right now is sky, and the rest of the
 * track is what's still available. The legend carries the same facts in text.
 */
export function BalanceBar({
  authorizedCents,
  capturedCents,
  reservedCents,
  availableCents,
  releasedCents = 0,
  compact = false,
}: Props) {
  const total = Math.max(authorizedCents, 1);
  const percent = (cents: number) => `${Math.min(Math.max((cents / total) * 100, 0), 100)}%`;
  const summary =
    `${formatUsd(capturedCents)} spent, ${formatUsd(reservedCents)} being paid, ` +
    `${formatUsd(availableCents)} available, of ${formatUsd(authorizedCents)} held.`;

  return (
    <div>
      <div className={compact ? "balance-bar balance-bar--compact" : "balance-bar"} role="img" aria-label={summary}>
        <div className="balance-bar__part balance-bar__part--captured" style={{ width: percent(capturedCents) }} />
        <div className="balance-bar__part balance-bar__part--reserved" style={{ width: percent(reservedCents) }} />
      </div>
      {!compact && (
        <ul className="balance__legend">
          <li>
            <span className="swatch swatch--captured" aria-hidden="true" />
            <span>
              Spent <strong className="money">{formatUsd(capturedCents)}</strong>
            </span>
          </li>
          {reservedCents > 0 && (
            <li>
              <span className="swatch swatch--reserved" aria-hidden="true" />
              <span>
                Being paid <strong className="money">{formatUsd(reservedCents)}</strong>
              </span>
            </li>
          )}
          {releasedCents > 0 ? (
            <li>
              <span className="swatch swatch--released" aria-hidden="true" />
              <span>
                Released <strong className="money">{formatUsd(releasedCents)}</strong>
              </span>
            </li>
          ) : (
            <li>
              <span className="swatch" aria-hidden="true" />
              <span>
                Available <strong className="money">{formatUsd(availableCents)}</strong>
              </span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
