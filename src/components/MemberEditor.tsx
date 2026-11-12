"use client";

import { useEffect, useId, useRef, useState } from "react";
import { formatUsd } from "@/domain/money";
import { STORES } from "@/domain/stores";
import { errorMessage, postJson } from "@/lib/client";
import type { MemberView } from "@/lib/views";

export type MemberEditTarget =
  | { mode: "edit"; member: MemberView }
  | { mode: "add"; kind: "person" | "agent"; label: string; member: MemberView | null };

function dollars(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

/**
 * The owner's dialog for one member's rules. The server checks every rule again
 * under the pool lock and explains any refusal, which is shown here as sent.
 */
export function MemberEditor({
  poolId,
  target,
  onClose,
  onSaved,
}: {
  poolId: string;
  target: MemberEditTarget;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const existing = target.member;
  const label = target.mode === "edit" ? target.member.label : target.label;
  const [limit, setLimit] = useState(existing ? dollars(existing.limitCents) : "");
  const [threshold, setThreshold] = useState(existing ? dollars(existing.approvalThresholdCents) : "");
  const [stores, setStores] = useState<string[]>(existing?.allowedStores ?? []);
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  async function run(kind: "save" | "remove") {
    if (busy) return;
    setBusy(kind);
    setError(null);
    try {
      if (kind === "remove" && target.mode === "edit") {
        await postJson(`/api/pools/${poolId}/members/${target.member.id}/remove`);
        onSaved(`${label} can't spend from this pool any more. What they already spent stays in the ledger.`);
      } else if (target.mode === "edit") {
        await postJson(`/api/pools/${poolId}/members/${target.member.id}`, { limit, threshold, stores });
        onSaved(`Saved ${label}'s rules.`);
      } else {
        await postJson(`/api/pools/${poolId}/members`, { kind: target.kind, limit, threshold, stores });
        onSaved(`${label} can spend from this pool${existing ? " again" : ""}.`);
      }
      dialog.current?.close();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(null);
    }
  }

  const title = target.mode === "edit" ? `${label}'s rules` : existing ? `Add ${label} back` : `Add ${label}`;
  const used = existing?.usedCents ?? 0;

  return (
    <dialog ref={dialog} className="dialog" aria-labelledby={`${id}-title`} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          void run("save");
        }}
      >
        <h2 id={`${id}-title`}>{title}</h2>
        {used > 0 && (
          <p className="muted small">
            {label} has already used <span className="money">{formatUsd(used)}</span>. The limit can&rsquo;t go below that.
          </p>
        )}
        <div className="field">
          <label htmlFor={`${id}-limit`}>Spending limit</label>
          <div className="input-money">
            <span aria-hidden="true">$</span>
            <input
              id={`${id}-limit`}
              className="input"
              inputMode="decimal"
              autoComplete="off"
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
              aria-describedby={`${id}-limit-hint`}
            />
          </div>
          <span id={`${id}-limit-hint`} className="field__hint">
            A raise can&rsquo;t be more than what&rsquo;s left in the pool.
          </span>
        </div>
        <div className="field">
          <label htmlFor={`${id}-threshold`}>Ask me first above</label>
          <div className="input-money">
            <span aria-hidden="true">$</span>
            <input
              id={`${id}-threshold`}
              className="input"
              inputMode="decimal"
              autoComplete="off"
              value={threshold}
              onChange={(event) => setThreshold(event.target.value)}
              aria-describedby={`${id}-threshold-hint`}
            />
          </div>
          <span id={`${id}-threshold-hint`} className="field__hint">
            Enter 0 to approve every purchase yourself.
          </span>
        </div>
        <fieldset>
          <legend>Stores they can buy from</legend>
          <div className="chips">
            {STORES.map((store) => (
              <label key={store} className="chip">
                <input
                  type="checkbox"
                  checked={stores.includes(store)}
                  onChange={(event) =>
                    setStores(event.target.checked ? [...stores, store] : stores.filter((name) => name !== store))
                  }
                />
                <span>{store}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div role="alert">{error && <div className="notice notice--stop">{error}</div>}</div>

        <div className="row">
          <button type="submit" className="button" aria-disabled={busy !== null}>
            {busy === "save" && <span className="spinner" aria-hidden="true" />}
            {target.mode === "edit" ? "Save" : existing ? "Add back" : "Add"}
          </button>
          <button type="button" className="button button--secondary" onClick={() => dialog.current?.close()}>
            Cancel
          </button>
        </div>
        {target.mode === "edit" && (
          <div className="stack stack--tight">
            <button
              type="button"
              className="button button--danger"
              aria-disabled={busy !== null}
              onClick={() => void run("remove")}
            >
              {busy === "remove" && <span className="spinner" aria-hidden="true" />}
              Remove from pool
            </button>
            <p className="muted small">They stop spending at once. Nothing they already bought is undone.</p>
          </div>
        )}
      </form>
    </dialog>
  );
}
