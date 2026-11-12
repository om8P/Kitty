/**
 * Turns a PayPal webhook body into Kitty's provider-neutral `PaymentEvent`.
 * Only call this on a body whose signature has been verified.
 *
 * Field rules come from the S07 sandbox run (docs/spike/S07.md):
 * - capture events carry the capture id, the capture's `invoice_id` and the
 *   authorization in `supplementary_data.related_ids`;
 * - refund events carry the refund id, the refunded capture's `invoice_id`
 *   and an `up` link to the capture;
 * - authorization events carry the authorization id.
 */
import { decimalToCents } from "@/domain/money";
import type { PaymentEvent } from "@/domain/ports";

const KINDS: Record<string, PaymentEvent["kind"]> = {
  "PAYMENT.CAPTURE.COMPLETED": "capture_completed",
  "PAYMENT.CAPTURE.DECLINED": "capture_declined",
  "PAYMENT.CAPTURE.DENIED": "capture_denied",
  "PAYMENT.CAPTURE.REFUNDED": "capture_refunded",
  "PAYMENT.AUTHORIZATION.CREATED": "authorization_created",
  "PAYMENT.AUTHORIZATION.VOIDED": "authorization_voided",
};

/** Kitty sends `invoice_id: kitty-{purchaseId}` on every capture (rail.ts). */
const INVOICE_PREFIX = "kitty-";

export type ParsedWebhook =
  | { ok: true; eventId: string; type: string; event: PaymentEvent | null }
  | { ok: false };

export function parseWebhookEvent(rawBody: string): ParsedWebhook {
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { ok: false };
  }
  if (!isObject(body)) return { ok: false };
  const eventId = text(body.id);
  const type = text(body.event_type);
  if (!eventId || !type) return { ok: false };

  const kind = KINDS[type];
  if (!kind) return { ok: true, eventId, type, event: null };

  const resource = isObject(body.resource) ? body.resource : {};
  const supplementary = isObject(resource.supplementary_data) ? resource.supplementary_data : {};
  const related = isObject(supplementary.related_ids) ? supplementary.related_ids : {};
  const resourceId = text(resource.id);
  const amountCents = isObject(resource.amount) ? decimalToCents(resource.amount.value) : null;
  const invoiceId = text(resource.invoice_id);
  const isRefund = kind === "capture_refunded";
  const isCapture = kind.startsWith("capture_") && !isRefund;
  const isAuthorization = kind.startsWith("authorization_");

  return {
    ok: true,
    eventId,
    type,
    event: {
      eventId,
      kind,
      type,
      purchaseId:
        !isAuthorization && invoiceId?.startsWith(INVOICE_PREFIX) ? invoiceId.slice(INVOICE_PREFIX.length) : null,
      captureId: isCapture
        ? resourceId
        : isRefund
          ? (text(related.capture_id) ?? linkedId(resource.links, "up", "captures"))
          : null,
      refundId: isRefund ? resourceId : null,
      authorizationId: isAuthorization
        ? resourceId
        : (text(related.authorization_id) ?? linkedId(resource.links, "up", "authorizations")),
      amountCents,
    },
  };
}

/** The id in a resource's link with this rel, for example the capture a refund belongs to. */
export function linkedId(links: unknown, rel: string, kind: "captures" | "authorizations"): string | null {
  if (!Array.isArray(links)) return null;
  for (const link of links) {
    if (!isObject(link) || link.rel !== rel || typeof link.href !== "string") continue;
    const match = link.href.match(new RegExp(`/${kind}/([^/?#]+)`));
    if (match) return match[1];
  }
  return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
