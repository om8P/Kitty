"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { errorMessage, postJson } from "@/lib/client";

/** Starts a fresh demo household. Asks for the access code only when the host requires one. */
export function StartDemo({ codeRequired }: { codeRequired: boolean }) {
  const router = useRouter();
  const codeId = useId();
  const errorId = useId();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (codeRequired && !code.trim()) {
      setError("Enter the access code from the submission notes.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await postJson("/api/demo/start", codeRequired ? { code } : {});
      router.push("/pools/new");
      router.refresh();
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={start} noValidate>
      {codeRequired && (
        <div className="field" style={{ maxWidth: 320 }}>
          <label htmlFor={codeId}>Access code</label>
          <input
            id={codeId}
            className="input"
            name="code"
            autoComplete="off"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
          />
        </div>
      )}
      <div className="row">
        <button className="button" type="submit" aria-disabled={busy}>
          {busy && <span className="spinner" aria-hidden="true" />}
          {busy ? "Setting up" : "Start the demo"}
        </button>
        <span className="muted small">No sign-up. No real money.</span>
      </div>
      <p id={errorId} className="field__error" role="alert">
        {error}
      </p>
    </form>
  );
}
