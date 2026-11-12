import { receiveWebhook } from "@/domain/webhooks";
import { getContainer } from "@/server/container";

export const dynamic = "force-dynamic";

/** PayPal's events are a few kilobytes. Anything far larger isn't one. */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * PayPal webhook intake (S38). No session: trust comes only from PayPal's
 * signature, checked on the raw body exactly as received. PayPal retries any
 * answer other than 2xx, so an unclear check answers 503 to get the event again.
 */
export async function POST(request: Request) {
  try {
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > MAX_BODY_BYTES) return Response.json({ error: "Too large." }, { status: 413 });
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) return Response.json({ error: "Too large." }, { status: 413 });

    const { db, rail } = await getContainer();
    const outcome = await receiveWebhook({ db, rail }, { rawBody, headers: request.headers });
    switch (outcome.result) {
      case "rejected":
        return Response.json({ error: "The signature didn't verify." }, { status: 401 });
      case "retry_later":
        return Response.json({ error: "The signature couldn't be checked. Send it again." }, { status: 503 });
      case "ignored":
        return Response.json({ result: "ignored" });
      default:
        return Response.json({ result: outcome.result, status: outcome.status });
    }
  } catch (error) {
    console.error("webhook failed", error instanceof Error ? error.name : "unknown");
    return Response.json({ error: "Kitty couldn't apply this event. Send it again." }, { status: 500 });
  }
}
