/**
 * The seams the domain depends on. Domain code imports only from here, never
 * from a framework or provider SDK. `src/db`, `src/adapters` and `src/ai`
 * implement these.
 */

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Database extends Queryable {
  /** Runs `fn` in one READ COMMITTED transaction. Throwing rolls it back. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
}

/**
 * Calls that move money never throw. An unclear outcome is `unknown`, never
 * `failed`, because funds are released only on a definite failure.
 */
export type RailResult<T> =
  | { outcome: "succeeded"; data: T }
  | { outcome: "failed" | "unsupported"; code: string; message: string }
  | { outcome: "unknown"; reason: string };

/**
 * A verified payment event, with no provider field names. `purchaseId` comes
 * from the invoice ID Kitty sends on every capture.
 */
export type PaymentEvent = {
  eventId: string;
  kind:
    | "capture_completed"
    | "capture_declined"
    | "capture_denied"
    | "capture_refunded"
    | "authorization_created"
    | "authorization_voided";
  /** The provider's own event type, kept for the record. */
  type: string;
  purchaseId: string | null;
  captureId: string | null;
  refundId: string | null;
  authorizationId: string | null;
  amountCents: number | null;
};

/** Read from an incoming request, for example `request.headers`. */
export type HeaderSource = { get(name: string): string | null };

export interface PaymentRail {
  /**
   * `unconfigured` means no PayPal keys are set: every call fails and no pool
   * can be created. `test` is the scripted rail in the test helpers, which the
   * app never uses.
   */
  readonly name: "paypal" | "unconfigured" | "test";
  /** False for a rail that charges each purchase on its own and holds no money (architecture 3). */
  readonly holdsRealFunds: boolean;
  createPoolPayment(input: {
    poolId: string;
    amountCents: number;
    returnUrl: string;
    cancelUrl: string;
  }): Promise<RailResult<{ orderId: string; approvalUrl: string }>>;
  confirmPoolPayment(input: {
    poolId: string;
    orderId: string;
  }): Promise<RailResult<{ authorizationId: string; authorizedCents: number | null; expiresAt: Date | null }>>;
  charge(input: {
    purchaseId: string;
    authorizationId: string;
    amountCents: number;
  }): Promise<RailResult<{ captureId: string }>>;
  refund(input: { purchaseId: string; captureId: string }): Promise<RailResult<{ refundId: string }>>;
  releaseHold(input: { authorizationId: string }): Promise<RailResult<Record<string, never>>>;
  /**
   * Checks a webhook's signature on the raw body exactly as received. On
   * success, `event` is null for a verified event Kitty has no use for.
   */
  verifyWebhookSignature(input: {
    rawBody: string;
    headers: HeaderSource;
  }): Promise<RailResult<{ event: PaymentEvent | null }>>;
  /** Reads one capture. Used when an amount disagrees (architecture 7.2). */
  getCapture(input: { captureId: string }): Promise<
    RailResult<{ captureId: string; status: string; amountCents: number | null; purchaseId: string | null }>
  >;
}

export type ReviewFacts = {
  poolGoal: string;
  memberLabel: string;
  memberKind: "person" | "agent";
  store: string;
  quantity: number;
  amountCents: number;
  /** Untrusted text. Passed to the model as labeled data only. */
  productTitle: string;
  productDescription: string;
};

export type ReviewResult =
  | { decision: "allow" | "flag" | "block"; reason: string }
  | { decision: "unavailable"; reason: string };

export interface Reviewer {
  /** Never throws. Any failure is `unavailable`, which sends the purchase to the owner. */
  review(facts: ReviewFacts): Promise<ReviewResult>;
}

export type CatalogProduct = {
  id: string;
  source: "seed" | "channel3";
  store: string;
  title: string;
  description: string;
  imageUrl: string | null;
  priceCents: number;
};

export interface Catalog {
  search(query: string): Promise<CatalogProduct[]>;
  featured(): Promise<CatalogProduct[]>;
}
