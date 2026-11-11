"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { errorMessage, postJson } from "@/lib/client";

type Person = { id: string; name: string; role: "owner" | "member" };

/**
 * Switches between the people in the demo household. The server re-checks
 * every action against the chosen person, so this only changes who you are.
 */
export function PersonaSwitcher({ people, currentId }: { people: Person[]; currentId: string }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function switchTo(person: Person) {
    if (person.id === currentId || pendingId) return;
    setPendingId(person.id);
    setError(null);
    try {
      await postJson("/api/demo/persona", { userId: person.id });
      router.push(person.role === "owner" ? "/pools" : "/shop");
      router.refresh();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="row" style={{ gap: "8px" }}>
      <div className="persona" role="group" aria-label="View as">
        {people.map((person) => (
          <button
            key={person.id}
            type="button"
            aria-pressed={person.id === currentId}
            disabled={pendingId !== null}
            onClick={() => switchTo(person)}
          >
            {person.name} · {person.role === "owner" ? "Owner" : "Teen"}
          </button>
        ))}
      </div>
      <span role="status" className="visually-hidden">
        {error ?? ""}
      </span>
    </div>
  );
}
