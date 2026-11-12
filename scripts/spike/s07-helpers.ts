/**
 * Pure helpers for the S07 webhook spike (scripts/spike/webhook-receiver.ts
 * and scripts/spike/07-webhooks.ts). Kept apart from the scripts so the
 * parsing can be tested.
 */

/** One webhook delivery as the receiver saves it. */
export type Delivery = {
  receivedAt: string;
  method: string;
  path: string;
  /** Only PayPal's own headers and the content type, lower-cased. */
  headers: Record<string, string>;
  /** The body exactly as received, so the signature can be checked later. */
  rawBody: string;
};

/**
 * Keeps only the headers the signature check needs. Tunnel headers such as
 * `x-forwarded-for` carry the sender's IP address and are dropped.
 */
export function pickPayPalHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase();
    if (value === undefined || !(key.startsWith("paypal-") || key === "content-type")) continue;
    kept[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return kept;
}

export function parseDelivery(text: string): Delivery | undefined {
  try {
    const value = JSON.parse(text) as Partial<Delivery>;
    if (typeof value.rawBody !== "string" || typeof value.headers !== "object" || value.headers === null) return undefined;
    return {
      receivedAt: String(value.receivedAt ?? ""),
      method: String(value.method ?? ""),
      path: String(value.path ?? ""),
      headers: value.headers,
      rawBody: value.rawBody,
    };
  } catch {
    return undefined;
  }
}

/** A `{ get }` view of saved headers, the shape `verifyWebhookSignature` takes. */
export function headerSource(headers: Record<string, string>): { get(name: string): string | null } {
  return { get: (name) => headers[name.toLowerCase()] ?? null };
}

/** What S07 records about one event: ids, codes and amounts only. */
export type EventSummary = {
  eventId?: string;
  eventType?: string;
  createTime?: string;
  resourceType?: string;
  resourceId?: string;
  status?: string;
  amount?: string;
  invoiceId?: string;
  customId?: string;
  authorizationId?: string;
  orderId?: string;
  /** The capture: the resource itself, or for a refund the capture its `up` link points to. */
  captureId?: string;
};

type Link = { rel?: unknown; href?: unknown };

/** The id in a resource's link with this rel, for example the order an authorization belongs to. */
export function linkedId(links: unknown, rel: string, kind: "captures" | "authorizations" | "orders"): string | undefined {
  if (!Array.isArray(links)) return undefined;
  for (const link of links as Link[]) {
    if (link?.rel !== rel || typeof link.href !== "string") continue;
    const match = link.href.match(new RegExp(`/${kind}/([^/?#]+)`));
    if (match) return match[1];
  }
  return undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function summarizeEvent(rawBody: string): EventSummary | undefined {
  let event: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
    event = parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const resource = (typeof event.resource === "object" && event.resource !== null ? event.resource : {}) as Record<
    string,
    unknown
  >;
  const amount = resource.amount as { value?: unknown } | undefined;
  const related = (resource.supplementary_data as { related_ids?: Record<string, unknown> } | undefined)?.related_ids;
  const resourceType = text(event.resource_type);
  const resourceId = text(resource.id);
  return {
    eventId: text(event.id),
    eventType: text(event.event_type),
    createTime: text(event.create_time),
    resourceType,
    resourceId,
    status: text(resource.status),
    amount: text(amount?.value),
    invoiceId: text(resource.invoice_id),
    customId: text(resource.custom_id),
    authorizationId:
      text(related?.authorization_id) ??
      (resourceType === "authorization" ? resourceId : undefined) ??
      linkedId(resource.links, "up", "authorizations"),
    orderId: text(related?.order_id) ?? linkedId(resource.links, "up", "orders"),
    captureId:
      text(related?.capture_id) ?? (resourceType === "capture" ? resourceId : linkedId(resource.links, "up", "captures")),
  };
}

/** A file name that sorts by arrival and stays unique per delivery. */
export function deliveryFileName(receivedAt: Date, transmissionId: string | undefined, seq: number): string {
  const stamp = receivedAt.toISOString().replace(/[:.]/g, "-");
  const id = (transmissionId ?? "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 40) || "no-id";
  return `${stamp}-${String(seq).padStart(3, "0")}-${id}.json`;
}
