"use client";

import { useId, useState } from "react";
import { formatUsd } from "@/domain/money";
import type { AgentStep, PurchaseStatus } from "@/domain/types";
import { STATUS_LABELS, type Tone } from "@/lib/labels";
import type { MemberView, RunView } from "@/lib/views";

const SUGGESTIONS = [
  "Buy what we need for a pasta dinner for four, under $25.",
  "Get breakfast basics for the week: milk, eggs, bread and fruit.",
  "Get snacks for movie night and a GameVault gift card.",
];

type Props = {
  agent: MemberView | undefined;
  run: RunView | undefined;
  aiReady: boolean;
  poolOpen: boolean;
  onStart: (task: string) => Promise<string | null>;
};

/** Give the shopping agent a task and watch each step: what it searched, what it asked to buy, and what the rules said. */
export function AgentPanel({ agent, run, aiReady, poolOpen, onStart }: Props) {
  const taskId = useId();
  const errorId = useId();
  const [task, setTask] = useState(SUGGESTIONS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = run?.status === "running";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || running) return;
    if (task.trim().length < 5) {
      setError("Tell the agent what to shop for.");
      return;
    }
    setBusy(true);
    setError(await onStart(task));
    setBusy(false);
  }

  if (!agent) return null;

  return (
    <section className="card stack" aria-labelledby={`${taskId}-title`}>
      <div className="section-title" style={{ marginBlockEnd: 0 }}>
        <h2 id={`${taskId}-title`}>Shopping agent</h2>
        <span className="muted small money">
          {formatUsd(agent.remainingCents)} left of {formatUsd(agent.limitCents)}
        </span>
      </div>

      {!aiReady ? (
        <div className="notice notice--warn">
          <span>
            <strong>The agent isn&rsquo;t connected to an AI model.</strong> Add a GROQ_API_KEY to the environment and
            restart to let it shop.
          </span>
        </div>
      ) : poolOpen ? (
        <form className="stack" onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor={taskId}>What should it buy?</label>
            <textarea
              id={taskId}
              className="input"
              name="task"
              rows={2}
              maxLength={300}
              value={task}
              onChange={(event) => setTask(event.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={errorId}
            />
            <span id={errorId} className="field__error" role="alert">
              {error}
            </span>
          </div>
          <div className="row" role="group" aria-label="Example tasks">
            {SUGGESTIONS.map((suggestion) => (
              <button key={suggestion} type="button" className="suggestion" onClick={() => setTask(suggestion)}>
                {suggestion}
              </button>
            ))}
          </div>
          <div className="row">
            <button className="button" type="submit" aria-disabled={busy || running}>
              {(busy || running) && <span className="spinner" aria-hidden="true" />}
              {running ? "Agent is shopping" : "Send the agent shopping"}
            </button>
            <p className="muted small grow">It can only search and ask to buy. Your rules decide the rest.</p>
          </div>
        </form>
      ) : null}

      {run && <RunLog run={run} />}
    </section>
  );
}

function RunLog({ run }: { run: RunView }) {
  return (
    <div className="stack" aria-live="polite">
      <p className="small">
        <strong>Task:</strong> {run.task}
      </p>
      {run.steps.length > 0 && (
        <ol className="steps">
          {run.steps.map((step, index) => (
            <Step key={index} step={step} />
          ))}
        </ol>
      )}
      {run.status === "running" && (
        <p className="row muted small">
          <span className="spinner" aria-hidden="true" />
          {run.steps.length === 0 ? "Reading the task" : "Deciding the next step"}
        </p>
      )}
      {run.status === "finished" && run.summary && (
        <div className="notice notice--ok">
          <span>
            <strong>Done.</strong> {run.summary}
          </span>
        </div>
      )}
      {run.status === "failed" && (
        <div className="notice notice--stop">
          <span>
            <strong>The agent stopped.</strong> {run.error}
          </span>
        </div>
      )}
    </div>
  );
}

const ICON: Record<Tone, { className: string; glyph: string }> = {
  ok: { className: "step__icon step__icon--ok", glyph: "✓" },
  warn: { className: "step__icon step__icon--warn", glyph: "?" },
  stop: { className: "step__icon step__icon--stop", glyph: "×" },
  neutral: { className: "step__icon", glyph: "•" },
};

function Step({ step }: { step: AgentStep }) {
  if (step.type === "search") {
    return (
      <li className="step">
        <span className="step__icon" aria-hidden="true">
          ⌕
        </span>
        <span>
          Searched for &ldquo;{step.query}&rdquo; <span className="muted">· {step.found} found</span>
        </span>
      </li>
    );
  }
  if (step.type === "note") {
    return (
      <li className="step">
        <span className="step__icon" aria-hidden="true">
          •
        </span>
        <span>{step.text}</span>
      </li>
    );
  }
  const known = STATUS_LABELS[step.status as PurchaseStatus] ?? { label: step.status, tone: "neutral" as Tone };
  const icon = ICON[known.tone];
  return (
    <li className="step">
      <span className={icon.className} aria-hidden="true">
        {icon.glyph}
      </span>
      <span>
        <strong>{known.label}:</strong> {step.title} · <span className="money">{formatUsd(step.amountCents)}</span>
        {step.status !== "captured" && (
          <>
            <br />
            <span className="muted small">{step.message}</span>
          </>
        )}
      </span>
    </li>
  );
}
