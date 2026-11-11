import { DomainError } from "@/domain/types";

const STATUS: Record<DomainError["code"], number> = {
  not_found: 404,
  forbidden: 403,
  conflict: 409,
  invalid: 400,
};

/** Runs a route handler and turns failures into `{ error }` JSON with a message that is safe to show. */
export async function handle(request: Request, run: () => Promise<Response>): Promise<Response> {
  try {
    if (request.method !== "GET" && !sameOrigin(request)) {
      return Response.json({ error: "This request came from another site." }, { status: 403 });
    }
    return await run();
  } catch (error) {
    if (error instanceof DomainError) {
      return Response.json({ error: error.message }, { status: STATUS[error.code] });
    }
    console.error("request failed", error instanceof Error ? error.name : "unknown");
    return Response.json({ error: "Unable to finish that. Nothing was charged. Try again in a moment." }, { status: 500 });
  }
}

/** A browser sends Origin on every cross-site POST, so a mismatch is refused. */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === publicHost(request);
  } catch {
    return false;
  }
}

function publicHost(request: Request): string {
  return request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
}

/** The public base URL, used for PayPal's return and cancel links. APP_URL wins when set. */
export function baseUrl(request: Request): string {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const host = publicHost(request);
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwarded ?? new URL(request.url).protocol.replace(":", "");
  return `${protocol}://${host}`;
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new DomainError("invalid", "The request wasn't valid JSON.");
  }
}
