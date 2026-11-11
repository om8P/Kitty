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

export interface PaymentRail {
  /** `simulated` means no PayPal keys are set and no real sandbox call is made. */
  readonly name: "paypal" | "simulated";
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
