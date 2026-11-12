import { formatUsd } from "@/domain/money";
import type { PoolPreview as Preview } from "@/lib/pool-preview";

/**
 * The live summary beside the Create a pool form: the amount to hold on
 * PayPal, and each spender's limit drawn against it with the balance bar's
 * own track. It updates as the owner types.
 */
export function PoolPreview({ preview, termLabel, paypalReady }: { preview: Preview; termLabel: string; paypalReady: boolean }) {
  return (
    <section className="card card--warm stack pool-preview" aria-labelledby="pool-preview-title">
      <div className="row row--between">
        <h2 id="pool-preview-title">Preview</h2>
        <span className="badge">{paypalReady ? "PayPal sandbox" : "Sandbox · PayPal isn't set up"}</span>
      </div>

      {preview.ready ? (
        <div className="balance__headline">
          <span className="balance__amount balance__amount--compact money">{formatUsd(preview.amountCents)}</span>
          <span className="muted small">held on PayPal for {termLabel}</span>
        </div>
      ) : (
        <p className="muted">Enter an amount from $5 to $500 to see the preview.</p>
      )}

      <ul className="pool-preview__spenders">
        {preview.spenders.map((spender) => (
          <li key={spender.kind}>
            <div className="row row--between">
              <span className="pool-preview__name">{spender.name}</span>
              <span className="money">{spender.limitCents === null ? "No limit yet" : formatUsd(spender.limitCents)}</span>
            </div>
            <div
              className="balance-bar balance-bar--compact"
              role="img"
              aria-label={
                spender.limitCents === null || !preview.ready
                  ? `${spender.name}: limit not set yet.`
                  : `${spender.name} can spend up to ${formatUsd(spender.limitCents)} of ${formatUsd(preview.amountCents)}.`
              }
            >
              <div className="balance-bar__part balance-bar__part--captured" style={{ width: `${spender.percent ?? 0}%` }} />
            </div>
            <p className={spender.overPool ? "field__error small" : "muted small"}>
              {spender.overPool
                ? "This limit is more than the pool."
                : spender.thresholdCents === null
                  ? "Approval amount not set yet."
                  : spender.thresholdCents === 0
                    ? "You approve every purchase."
                    : `You approve purchases over ${formatUsd(spender.thresholdCents)}.`}
            </p>
          </li>
        ))}
      </ul>

      {preview.ready && (
        <p className="small">
          {preview.shared ? (
            <>
              Limits add up to <strong className="money">{formatUsd(preview.limitsCents)}</strong>, more than the pool.
              Spenders share it, so whoever buys first uses it first.
            </>
          ) : (
            <>
              Limits add up to <strong className="money">{formatUsd(preview.limitsCents)}</strong> of{" "}
              <span className="money">{formatUsd(preview.amountCents)}</span>.{" "}
              {preview.unassignedCents > 0 && (
                <>
                  <span className="money">{formatUsd(preview.unassignedCents)}</span> stays in no one&apos;s limit and is
                  released when the pool closes.
                </>
              )}
            </>
          )}
        </p>
      )}
    </section>
  );
}
