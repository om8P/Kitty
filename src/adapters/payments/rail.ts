/**
 * The payment rail seam: all PayPal knowledge lives here (architecture 3).
 *
 * A pool is one PayPal authorization. Each purchase is a partial capture on
 * it, and closing the pool voids what is left. Every write carries a request
 * ID fixed for the life of the pool or purchase, so a retry can never charge
 * twice (architecture 7.2).
 */
import type { PaymentRail, RailResult } from "@/domain/ports";
import { decimalToCents, toDecimalString } from "@/domain/money";
import { createPayPalClient, type PayPalAuthorization, type PayPalClient, type PayPalResult } from "./paypal-client";

type Env = Record<string, string | undefined>;

export function createRail(env: Env = process.env): PaymentRail {
  const clientId = env.PAYPAL_CLIENT_ID?.trim();
  const clientSecret = env.PAYPAL_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return createUnconfiguredRail();
  return createPayPalRail(
    createPayPalClient({ clientId, clientSecret, webhookId: env.PAYPAL_WEBHOOK_ID?.trim() ?? "" }),
  );
}

export function createPayPalRail(client: PayPalClient): PaymentRail {
  return {
    name: "paypal",

    async createPoolPayment({ poolId, amountCents, returnUrl, cancelUrl }) {
      const result = await client.createOrder({
        requestId: `kitty-order-${poolId}`,
        amount: { currencyCode: "USD", value: toDecimalString(amountCents) },
        returnUrl,
        cancelUrl,
        customId: poolId,
      });
      return map(result, (data) => ({ orderId: data.order.id, approvalUrl: data.approvalUrl }));
    },

    async confirmPoolPayment({ poolId, orderId }) {
      const result = await client.authorizeOrder({ orderId, requestId: `kitty-auth-${poolId}` });
      if (result.outcome === "succeeded") return { outcome: "succeeded", data: describe(result.data.authorization) };
      if (result.outcome !== "unknown") return map(result, () => never());

      // An unclear answer may mean an earlier call already authorized it, so read the order.
      const order = await client.getOrder(orderId);
      const authorization =
        order.outcome === "succeeded" ? order.data.purchase_units?.[0]?.payments?.authorizations?.[0] : undefined;
      if (authorization && authorization.status !== "DENIED" && authorization.status !== "VOIDED") {
        return { outcome: "succeeded", data: describe(authorization) };
      }
      return { outcome: "unknown", reason: result.reason };
    },

    async charge({ purchaseId, authorizationId, amountCents }) {
      const result = await client.captureAuthorization({
        authorizationId,
        requestId: `kitty-capture-${purchaseId}`,
        amount: { currencyCode: "USD", value: toDecimalString(amountCents) },
        invoiceId: `kitty-${purchaseId}`,
        // Never final: the pool keeps taking captures until it closes.
        finalCapture: false,
      });
      return map(result, (capture) => ({ captureId: capture.id }));
    },

    async refund({ purchaseId, captureId }) {
      const result = await client.refundCapture({ captureId, requestId: `kitty-refund-${purchaseId}` });
      return map(result, (refund) => ({ refundId: refund.id }));
    },

    async releaseHold({ authorizationId }) {
      const result = await client.voidAuthorization({ authorizationId, requestId: `kitty-void-${authorizationId}` });
      if (result.outcome !== "unknown") return map(result, () => ({}));

      // An unclear answer may mean an earlier void already worked, so read the hold.
      const current = await client.getAuthorization(authorizationId);
      const status = current.outcome === "succeeded" ? current.data.status : undefined;
      if (status === "VOIDED") return { outcome: "succeeded", data: {} };
      if (status === "CAPTURED" || status === "EXPIRED") {
        return { outcome: "unsupported", code: `AUTHORIZATION_${status}`, message: "There is no open hold to release" };
      }
      return { outcome: "unknown", reason: result.reason };
    },
  };
}

export const PAYPAL_NOT_SET_UP = "PayPal isn't set up. Add the sandbox keys to .env (see .env.example), then restart.";

/**
 * Used when no PayPal keys are set. It makes no network calls and every call
 * fails, so no payment can be approved without PayPal (architecture 3).
 */
export function createUnconfiguredRail(): PaymentRail {
  const refuse = async () =>
    ({ outcome: "unsupported", code: "PAYPAL_NOT_SET_UP", message: PAYPAL_NOT_SET_UP }) as const;
  return {
    name: "unconfigured",
    createPoolPayment: refuse,
    confirmPoolPayment: refuse,
    charge: refuse,
    refund: refuse,
    releaseHold: refuse,
  };
}

function describe(authorization: PayPalAuthorization) {
  const expires = authorization.expiration_time ? new Date(authorization.expiration_time) : null;
  return {
    authorizationId: authorization.id,
    authorizedCents: decimalToCents(authorization.amount?.value),
    expiresAt: expires && !Number.isNaN(expires.getTime()) ? expires : null,
  };
}

function map<T, U>(result: PayPalResult<T>, pick: (data: T) => U): RailResult<U> {
  if (result.outcome === "succeeded") return { outcome: "succeeded", data: pick(result.data) };
  if (result.outcome === "unknown") return { outcome: "unknown", reason: result.reason };
  return { outcome: result.outcome, code: result.code, message: result.message };
}

function never(): never {
  throw new Error("unreachable");
}
