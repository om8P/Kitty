"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatUsd } from "@/domain/money";
import { errorMessage, getJson, postJson } from "@/lib/client";
import { formatDay, purchaseExplanation } from "@/lib/labels";
import type { MemberView, PoolStateView, PurchaseView } from "@/lib/views";
import { AgentPanel } from "./AgentPanel";
import { BalanceBar } from "./BalanceBar";
import type { LedgerAction } from "./LedgerGrid";
import { PoolStatusBadge } from "./PoolStatusBadge";

// AG Grid measures the DOM, so it loads in the browser only.
const LedgerGrid = dynamic(() => import("./LedgerGrid").then((module) => module.LedgerGrid), {
  ssr: false,
  loading: () => <div className="skeleton" style={{ height: 220 }} aria-hidden="true" />,
});

const POLL_MS = 2000;

const ACTION_DONE: Record<LedgerAction, string> = {
  approve: "Approved",
  deny: "Denied",
  refund: "Refund requested for",
  recheck: "Checked",
};

/** The owner's view of one pool: the money first, then what needs a decision, then everything else. */
export function PoolDashboard({ initial }: { initial: PoolStateView }) {
  const [state, setState] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "stop"; text: string } | null>(null);
  const [stale, setStale] = useState(false);
  const [closing, setClosing] = useState(false);
  const closeDialog = useRef<HTMLDialogElement>(null);
  const poolId = initial.pool.id;

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setState(await getJson<PoolStateView>(`/api/pools/${poolId}`, signal));
        setStale(false);
      } catch (failure) {
        if (failure instanceof DOMException) return;
        setStale(true);
      }
    },
    [poolId],
  );

  const { pool, members, purchases, runs, capabilities } = state;
  const live = pool.status === "active" || pool.status === "closing";

  useEffect(() => {
    if (!live) return;
    const controller = new AbortController();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh(controller.signal);
    }, POLL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [live, refresh]);

  const act = useCallback(
    async (purchase: PurchaseView, action: LedgerAction) => {
      setBusyId(purchase.id);
      setMessage(null);
      try {
        const result = await postJson<{ status: string; message: string | null }>(
          `/api/purchases/${purchase.id}/${action}`,
        );
        const refused = action === "approve" && result.status !== "captured";
        setMessage(
          refused
            ? { tone: "stop", text: `${purchase.title} wasn't paid. ${result.message ?? ""}` }
            : { tone: "ok", text: `${ACTION_DONE[action]} ${purchase.title}.` },
        );
      } catch (failure) {
        setMessage({ tone: "stop", text: errorMessage(failure) });
      } finally {
        await refresh();
        setBusyId(null);
      }
    },
    [refresh],
  );

  async function startAgent(task: string): Promise<string | null> {
    try {
      await postJson(`/api/pools/${poolId}/agent`, { task });
      await refresh();
      return null;
    } catch (failure) {
      return errorMessage(failure);
    }
  }

  async function closePool() {
    setClosing(true);
    setMessage(null);
    try {
      await postJson(`/api/pools/${poolId}/close`);
      closeDialog.current?.close();
      await refresh();
    } catch (failure) {
      closeDialog.current?.close();
      setMessage({ tone: "stop", text: errorMessage(failure) });
    } finally {
      setClosing(false);
    }
  }

  const waiting = purchases.filter((purchase) => purchase.status === "awaiting_approval");
  const agent = members.find((member) => member.kind === "agent");
  const leftover = pool.authorizedCents - pool.capturedCents;

  return (
    <div className="stack stack--loose">
      <div className="stack stack--tight">
        <p className="small">
          <Link href="/pools">All pools</Link>
        </p>
        <div className="row row--between">
          <div className="row">
            <h1>{pool.goal}</h1>
            <PoolStatusBadge pool={pool} />
          </div>
          {live && (
            <button
              type="button"
              className="button button--secondary"
              onClick={() => closeDialog.current?.showModal()}
            >
              {pool.status === "closing" ? "Finish closing" : "Close pool"}
            </button>
          )}
        </div>
      </div>

      <div role="status">
        {message && (
          <div className={message.tone === "ok" ? "notice notice--ok" : "notice notice--stop"}>
            <span className="grow">{message.text}</span>
            <button type="button" className="button button--secondary button--small" onClick={() => setMessage(null)}>
              Dismiss
            </button>
          </div>
        )}
      </div>
      {stale && (
        <div className="notice notice--warn" role="status">
          <span>
            <strong>This page may be out of date.</strong> Kitty couldn&rsquo;t refresh it. It keeps trying.
          </span>
        </div>
      )}

      <section className="card" aria-labelledby="balance-title">
        <h2 id="balance-title" className="visually-hidden">
          Balance
        </h2>
        {pool.status === "closed" ? (
          <div className="balance__headline">
            <span className="balance__amount">{formatUsd(pool.capturedCents)}</span>
            <span className="muted">
              spent of {formatUsd(pool.authorizedCents)} held
              {pool.closedAt ? ` · closed ${formatDay(pool.closedAt)}` : ""}
            </span>
          </div>
        ) : (
          <div className="balance__headline">
            <span className="balance__amount">{formatUsd(pool.availableCents)}</span>
            <span className="muted">
              available of {formatUsd(pool.authorizedCents)} held on{" "}
              {capabilities.payments === "paypal" ? "PayPal (sandbox)" : "a simulated hold"} · ends{" "}
              {formatDay(pool.endsAt)}
            </span>
          </div>
        )}
        <BalanceBar
          authorizedCents={pool.authorizedCents}
          capturedCents={pool.capturedCents}
          reservedCents={pool.reservedCents}
          availableCents={pool.availableCents}
          releasedCents={pool.releasedCents}
        />
        {pool.refundedCents > 0 && (
          <p className="muted small" style={{ marginBlockStart: "var(--space-3)" }}>
            <span className="money">{formatUsd(pool.refundedCents)}</span> was refunded to you. Refunds go back to your
            PayPal account, not back into the pool.
          </p>
        )}
        {pool.note && (
          <p className="small" style={{ marginBlockStart: "var(--space-3)" }}>
            {pool.note}
          </p>
        )}
      </section>

      {waiting.length > 0 && (
        <section className="notice notice--warn" aria-labelledby="decide-title">
          <div className="stack stack--tight" style={{ width: "100%" }}>
            <h2 id="decide-title">
              {waiting.length === 1 ? "1 purchase needs your decision" : `${waiting.length} purchases need your decision`}
            </h2>
            <ul className="decision-list">
              {waiting.map((purchase) => (
                <li key={purchase.id} className="decision">
                  <div className="grow" style={{ minWidth: 220 }}>
                    <strong>
                      {purchase.memberLabel} · {purchase.title}
                      {purchase.quantity > 1 ? ` × ${purchase.quantity}` : ""} ·{" "}
                      <span className="money">{formatUsd(purchase.amountCents)}</span>
                    </strong>
                    <p className="decision__why">{purchaseExplanation(purchase)}</p>
                  </div>
                  <div className="row">
                    <button
                      type="button"
                      className="button button--small"
                      disabled={busyId === purchase.id}
                      aria-label={`Approve ${purchase.title}`}
                      onClick={() => act(purchase, "approve")}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="button button--secondary button--small"
                      disabled={busyId === purchase.id}
                      aria-label={`Deny ${purchase.title}`}
                      onClick={() => act(purchase, "deny")}
                    >
                      Deny
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <div className="dashboard-grid">
        <section className="card" aria-labelledby="members-title">
          <h2 id="members-title" className="card__title">
            Who can spend
          </h2>
          <ul className="member-list">
            {members.map((member) => (
              <MemberRow key={member.id} member={member} />
            ))}
          </ul>
        </section>
        <AgentPanel
          agent={agent}
          run={runs[0]}
          aiReady={capabilities.ai}
          poolOpen={pool.status === "active"}
          onStart={startAgent}
        />
      </div>

      <section aria-labelledby="ledger-title">
        <div className="section-title">
          <h2 id="ledger-title">Ledger</h2>
          <span className="muted small">Every purchase attempt, with the rule result and the AI check.</span>
        </div>
        {purchases.length === 0 ? (
          <div className="empty">
            <h3>No purchases yet</h3>
            <p className="muted">
              Send the agent shopping above, or switch to {members.find((member) => member.kind === "person")?.label ?? "a family member"}{" "}
              in the header to buy something. Every attempt shows up here.
            </p>
          </div>
        ) : (
          <LedgerGrid purchases={purchases} busyId={busyId} readOnly={false} onAction={act} />
        )}
      </section>

      <dialog ref={closeDialog} className="dialog" aria-labelledby="close-title">
        <div className="stack">
          <h2 id="close-title">Close &ldquo;{pool.goal}&rdquo;?</h2>
          <p>
            {leftover > 0 ? (
              <>
                Kitty releases the <strong className="money">{formatUsd(leftover)}</strong> that wasn&rsquo;t spent
                back to your PayPal account.{" "}
              </>
            ) : null}
            Nobody can spend from this pool afterwards
            {waiting.length > 0 ? `, and the ${waiting.length} waiting ${waiting.length === 1 ? "request expires" : "requests expire"}` : ""}.
            This can&rsquo;t be undone.
          </p>
          <div className="row">
            <button type="button" className="button button--danger" onClick={closePool} aria-disabled={closing}>
              {closing && <span className="spinner" aria-hidden="true" />}
              Close pool
            </button>
            <button type="button" className="button button--secondary" onClick={() => closeDialog.current?.close()}>
              Keep it open
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}

function MemberRow({ member }: { member: MemberView }) {
  const used = member.limitCents > 0 ? Math.min((member.usedCents / member.limitCents) * 100, 100) : 0;
  return (
    <li className="member">
      <span className={member.kind === "agent" ? "avatar avatar--agent" : "avatar"} aria-hidden="true">
        {member.kind === "agent" ? "AI" : member.label.slice(0, 1)}
      </span>
      <div className="grow">
        <div className="row row--between">
          <h3>{member.label}</h3>
          <span className="money small">
            <strong>{formatUsd(member.remainingCents)}</strong> left of {formatUsd(member.limitCents)}
          </span>
        </div>
        <div className="meter" aria-hidden="true">
          <span style={{ width: `${used}%` }} />
        </div>
        <p className="muted small">
          {member.approvalThresholdCents === 0
            ? "Asks you before every purchase"
            : `Asks you above ${formatUsd(member.approvalThresholdCents)}`}{" "}
          · {member.allowedStores.join(", ")}
        </p>
      </div>
    </li>
  );
}
