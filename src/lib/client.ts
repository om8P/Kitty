/** Browser-side fetch helpers. Every failure becomes a message that says what to do next. */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const OFFLINE = "Unable to reach Kitty. Check your connection and try again.";

export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  return send<T>(url, { signal, cache: "no-store" });
}

export async function postJson<T>(url: string, body: unknown = {}): Promise<T> {
  return send<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function send<T>(url: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(OFFLINE, 0);
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    data = undefined;
  }
  if (!response.ok) {
    const message =
      typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
        ? data.error
        : "Unable to finish that. Try again in a moment.";
    throw new ApiError(message, response.status);
  }
  return data as T;
}

export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : OFFLINE;
}
