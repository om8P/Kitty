"use client";

import { useId, useRef, useState } from "react";
import { parseDollars } from "@/domain/money";
import { STORES } from "@/domain/stores";
import { errorMessage, postJson } from "@/lib/client";

type MemberDraft = {
  kind: "person" | "agent";
  name: string;
  about: string;
  limit: string;
  threshold: string;
  stores: string[];
};

type Errors = Partial<Record<"goal" | "amount" | "form" | `limit-${number}` | `threshold-${number}` | `stores-${number}`, string>>;

const TERMS = [
  { days: 7, label: "1 week" },
  { days: 14, label: "2 weeks" },
  { days: 28, label: "4 weeks" },
];

/** Create a pool: the goal and amount, then each spender's limit, approval amount and stores. */
export function NewPoolForm({ teenName, paypalReady }: { teenName: string; paypalReady: boolean }) {
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [goal, setGoal] = useState("Weekly groceries");
  const [amount, setAmount] = useState("150");
  const [termDays, setTermDays] = useState(28);
  const [members, setMembers] = useState<MemberDraft[]>([
    {
      kind: "person",
      name: teenName,
      about: "Family member",
      limit: "40",
      threshold: "15",
      stores: ["Fresh Market", "Corner Pharmacy"],
    },
    {
      kind: "agent",
      name: "Shopping agent",
      about: "AI agent that shops for you",
      limit: "80",
      threshold: "25",
      stores: ["Fresh Market"],
    },
  ]);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  function updateMember(index: number, patch: Partial<MemberDraft>) {
    setMembers((current) => current.map((member, at) => (at === index ? { ...member, ...patch } : member)));
  }

  function validate(): Errors {
    const found: Errors = {};
    if (goal.trim().length < 3) found.goal = "Describe what this pool is for, for example Weekly groceries.";
    const amountCents = parseDollars(amount);
    if (amountCents === null || amountCents < 500 || amountCents > 50000) {
      found.amount = "Enter an amount from $5 to $500.";
    }
    members.forEach((member, index) => {
      const limit = parseDollars(member.limit);
      if (limit === null || limit <= 0) found[`limit-${index}`] = "Enter a limit above $0.";
      else if (amountCents !== null && limit > amountCents) {
        found[`limit-${index}`] = "Choose a limit no higher than the pool amount.";
      }
      if (parseDollars(member.threshold) === null) found[`threshold-${index}`] = "Enter $0 or more.";
      if (member.stores.length === 0) found[`stores-${index}`] = "Choose at least one store.";
    });
    return found;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      // Move focus to the first field that needs fixing.
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    setBusy(true);
    try {
      const result = await postJson<{ approvalUrl: string }>("/api/pools", {
        goal,
        amount,
        termDays,
        members: members.map((member) => ({
          kind: member.kind,
          limit: member.limit,
          threshold: member.threshold,
          stores: member.stores,
        })),
      });
      // The one approval happens on PayPal's own site.
      window.location.assign(result.approvalUrl);
    } catch (failure) {
      setErrors({ form: errorMessage(failure) });
      setBusy(false);
    }
  }

  return (
    <form ref={formRef} className="stack stack--loose" onSubmit={submit} noValidate>
      <section className="card stack" aria-labelledby={`${id}-pool`}>
        <h2 id={`${id}-pool`}>The pool</h2>
        <div className="field">
          <label htmlFor={`${id}-goal`}>What is it for?</label>
          <input
            id={`${id}-goal`}
            className="input"
            name="goal"
            value={goal}
            maxLength={120}
            autoComplete="off"
            onChange={(event) => setGoal(event.target.value)}
            aria-invalid={errors.goal ? true : undefined}
            aria-describedby={`${id}-goal-hint`}
          />
          <span id={`${id}-goal-hint`} className={errors.goal ? "field__error" : "field__hint"}>
            {errors.goal ?? "AI checks each purchase against this goal."}
          </span>
        </div>
        <div className="form-grid">
          <MoneyField
            id={`${id}-amount`}
            label="Amount to set aside"
            value={amount}
            onChange={setAmount}
            error={errors.amount}
            hint="Held on PayPal, charged only as it's spent."
          />
          <div className="field">
            <label htmlFor={`${id}-term`}>Open for</label>
            <select
              id={`${id}-term`}
              className="input"
              name="term"
              value={termDays}
              onChange={(event) => setTermDays(Number(event.target.value))}
            >
              {TERMS.map((term) => (
                <option key={term.days} value={term.days}>
                  {term.label}
                </option>
              ))}
            </select>
            <span className="field__hint">Unspent money is released when it closes.</span>
          </div>
        </div>
      </section>

      <section className="stack" aria-labelledby={`${id}-who`}>
        <h2 id={`${id}-who`}>Who can spend</h2>
        {members.map((member, index) => (
          <div key={member.kind} className="card stack" role="group" aria-labelledby={`${id}-member-${index}`}>
            <div className="row">
              <span className={member.kind === "agent" ? "avatar avatar--agent" : "avatar"} aria-hidden="true">
                {member.kind === "agent" ? "AI" : member.name.slice(0, 1)}
              </span>
              <div>
                <h3 id={`${id}-member-${index}`}>{member.name}</h3>
                <p className="muted small">{member.about}</p>
              </div>
            </div>
            <div className="form-grid">
              <MoneyField
                id={`${id}-limit-${index}`}
                label="Spending limit"
                value={member.limit}
                onChange={(limit) => updateMember(index, { limit })}
                error={errors[`limit-${index}`]}
                hint="The most they can spend from this pool."
              />
              <MoneyField
                id={`${id}-threshold-${index}`}
                label="Ask me first above"
                value={member.threshold}
                onChange={(threshold) => updateMember(index, { threshold })}
                error={errors[`threshold-${index}`]}
                hint="Enter 0 to approve every purchase yourself."
              />
            </div>
            <fieldset aria-describedby={errors[`stores-${index}`] ? `${id}-stores-${index}-error` : undefined}>
              <legend>Stores they can buy from</legend>
              <div className="chips">
                {STORES.map((store) => (
                  <label key={store} className="chip">
                    <input
                      type="checkbox"
                      name={`stores-${index}`}
                      checked={member.stores.includes(store)}
                      aria-invalid={errors[`stores-${index}`] ? true : undefined}
                      onChange={(event) =>
                        updateMember(index, {
                          stores: event.target.checked
                            ? [...member.stores, store]
                            : member.stores.filter((name) => name !== store),
                        })
                      }
                    />
                    <span>{store}</span>
                  </label>
                ))}
              </div>
              {errors[`stores-${index}`] && (
                <p id={`${id}-stores-${index}-error`} className="field__error" style={{ marginBlockStart: 8 }}>
                  {errors[`stores-${index}`]}
                </p>
              )}
            </fieldset>
          </div>
        ))}
      </section>

      <div className="stack">
        <p className="field__error" role="alert">
          {errors.form}
        </p>
        <div className="row">
          <button className="button" type="submit" aria-disabled={busy}>
            {busy && <span className="spinner" aria-hidden="true" />}
            {busy ? "Opening PayPal" : "Continue to PayPal"}
          </button>
          <p className="muted small grow">
            {paypalReady
              ? "You approve once on PayPal's sandbox site. No real money moves."
              : "PayPal isn't set up yet, so a pool can't be created. Add the sandbox keys to .env, then restart."}
          </p>
        </div>
      </div>
    </form>
  );
}

function MoneyField(props: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint: string;
}) {
  return (
    <div className="field">
      <label htmlFor={props.id}>{props.label}</label>
      <div className="input-money">
        <span aria-hidden="true">$</span>
        <input
          id={props.id}
          className="input"
          inputMode="decimal"
          autoComplete="off"
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          aria-invalid={props.error ? true : undefined}
          aria-describedby={`${props.id}-hint`}
        />
      </div>
      <span id={`${props.id}-hint`} className={props.error ? "field__error" : "field__hint"}>
        {props.error ?? props.hint}
      </span>
    </div>
  );
}
