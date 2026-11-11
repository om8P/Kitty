"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { formatUsd } from "@/domain/money";
import { errorMessage, getJson, postJson } from "@/lib/client";
import { formatTime, purchaseExplanation } from "@/lib/labels";
import type { ProductView, PurchaseView, ShopView } from "@/lib/views";
import { StatusBadge } from "./StatusBadge";

const POLL_MS = 3000;

type Props = { initial: ShopView; initialProducts: ProductView[]; ownerName: string };

/** A family member's view: what they can still spend, the marketplace, and what happened to each request. */
export function Shop({ initial, initialProducts, ownerName }: Props) {
  const searchId = useId();
  const resultRef = useRef<HTMLDivElement>(null);
  const [shop, setShop] = useState(initial);
  const [products, setProducts] = useState(initialProducts);
  const [query, setQuery] = useState("");
  const [shownQuery, setShownQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [buyingId, setBuyingId] = useState<string | null>(null);
  const [result, setResult] = useState<{ purchase?: PurchaseView; error?: string } | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      setShop(await getJson<ShopView>("/api/shop", signal));
    } catch {
      // The next poll tries again. The last known state stays on screen.
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh(controller.signal);
    }, POLL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [refresh]);

  async function search(event: React.FormEvent) {
    event.preventDefault();
    if (searching) return;
    setSearching(true);
    setSearchError(null);
    try {
      const found = await getJson<{ query: string; products: ProductView[] }>(
        `/api/products?q=${encodeURIComponent(query.trim())}`,
      );
      setProducts(found.products);
      setShownQuery(found.query);
    } catch (failure) {
      setSearchError(errorMessage(failure));
    } finally {
      setSearching(false);
    }
  }

  async function buy(product: ProductView) {
    if (buyingId || !shop.pool) return;
    setBuyingId(product.id);
    setResult(null);
    try {
      const response = await postJson<{ purchase: PurchaseView }>("/api/purchases", {
        poolId: shop.pool.id,
        productId: product.id,
        quantity: 1,
        requestKey: crypto.randomUUID(),
      });
      setResult({ purchase: response.purchase });
    } catch (failure) {
      setResult({ error: errorMessage(failure) });
    } finally {
      await refresh();
      setBuyingId(null);
      resultRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  const { pool, member, purchases } = shop;

  if (!pool || !member) {
    return (
      <div className="empty">
        <h1>No open pool to spend from</h1>
        <p className="muted">
          When {ownerName} opens a pool and adds you, your limit and the shop show up here. Switch to {ownerName} in
          the header to create one.
        </p>
      </div>
    );
  }

  const used = member.limitCents > 0 ? Math.min((member.usedCents / member.limitCents) * 100, 100) : 0;

  return (
    <div className="stack stack--loose">
      <section className="card" aria-labelledby="limit-title">
        <p className="muted small">{pool.goal}</p>
        <h1 id="limit-title" className="visually-hidden">
          Your spending limit
        </h1>
        <div className="balance__headline">
          <span className="balance__amount">{formatUsd(member.remainingCents)}</span>
          <span className="muted">left of your {formatUsd(member.limitCents)} limit</span>
        </div>
        <div className="meter" style={{ height: 10, marginBlock: "var(--space-3)" }} aria-hidden="true">
          <span style={{ width: `${used}%` }} />
        </div>
        <p className="muted small">
          {member.approvalThresholdCents === 0
            ? `${ownerName} approves every purchase`
            : `Purchases above ${formatUsd(member.approvalThresholdCents)} ask ${ownerName} first`}{" "}
          · You can buy from {member.allowedStores.join(", ")}
        </p>
      </section>

      <div ref={resultRef} role="status">
        {result && <BuyResult result={result} ownerName={ownerName} onDismiss={() => setResult(null)} />}
      </div>

      <section className="stack" aria-labelledby="shop-title">
        <div className="section-title" style={{ marginBlockEnd: 0 }}>
          <h2 id="shop-title">Shop</h2>
          <span className="muted small">
            {shop.capabilities.catalog === "channel3"
              ? "Real products from Channel3. Checkout stays in the sandbox."
              : "Sample products. Checkout stays in the sandbox."}
          </span>
        </div>
        <form className="search-form" role="search" onSubmit={search}>
          <label htmlFor={searchId} className="visually-hidden">
            Search products
          </label>
          <input
            id={searchId}
            className="input"
            type="search"
            name="q"
            placeholder="pasta sauce"
            value={query}
            maxLength={80}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="submit" className="button button--secondary" aria-disabled={searching}>
            {searching && <span className="spinner" aria-hidden="true" />}
            Search
          </button>
        </form>
        {searchError && (
          <p className="field__error" role="alert">
            {searchError}
          </p>
        )}

        {products.length === 0 ? (
          <div className="empty">
            <h3>No products for &ldquo;{shownQuery}&rdquo;</h3>
            <p className="muted">Try a simpler search, such as milk or snacks.</p>
            <button
              type="button"
              className="button button--secondary"
              onClick={async () => {
                setQuery("");
                const found = await getJson<{ products: ProductView[] }>("/api/products").catch(() => null);
                if (found) {
                  setProducts(found.products);
                  setShownQuery("");
                }
              }}
            >
              Show the sample shelf
            </button>
          </div>
        ) : (
          <ul className="product-grid">
            {products.map((product) => (
              <li key={product.id} className="product">
                <div className="product__image">
                  {product.imageUrl ? (
                    // Product images come from many retailer hosts, so they can't go through next/image.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={product.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
                  ) : (
                    <span aria-hidden="true">{product.title.slice(0, 1)}</span>
                  )}
                </div>
                <div className="stack stack--tight">
                  <h3 className="product__title" title={product.title}>
                    {product.title}
                  </h3>
                  <p className="muted small">{product.store}</p>
                </div>
                <div className="product__footer">
                  <span className="product__price">{formatUsd(product.priceCents)}</span>
                  <button
                    type="button"
                    className="button button--small"
                    disabled={buyingId !== null}
                    aria-label={`Buy ${product.title} for ${formatUsd(product.priceCents)}`}
                    onClick={() => buy(product)}
                  >
                    {buyingId === product.id && <span className="spinner" aria-hidden="true" />}
                    {buyingId === product.id ? "Checking" : "Buy"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" aria-labelledby="requests-title">
        <h2 id="requests-title" className="card__title">
          Your requests
        </h2>
        {purchases.length === 0 ? (
          <p className="muted">Nothing yet. Pick something from the shop and Kitty checks it against the pool&rsquo;s rules.</p>
        ) : (
          <ul className="request-list">
            {purchases.map((purchase) => (
              <li key={purchase.id} className="request">
                <div className="grow" style={{ minWidth: 200 }}>
                  <strong>{purchase.title}</strong>{" "}
                  <span className="muted small">
                    · {purchase.store} · {formatTime(purchase.createdAt)}
                  </span>
                  {purchaseExplanation(purchase) && <p className="muted small">{purchaseExplanation(purchase)}</p>}
                </div>
                <span className="money">{formatUsd(purchase.amountCents)}</span>
                <StatusBadge status={purchase.status} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function BuyResult({
  result,
  ownerName,
  onDismiss,
}: {
  result: { purchase?: PurchaseView; error?: string };
  ownerName: string;
  onDismiss: () => void;
}) {
  const purchase = result.purchase;
  let tone = "notice notice--stop";
  let title = "That didn't go through.";
  let detail = result.error ?? "";

  if (purchase) {
    const amount = formatUsd(purchase.amountCents);
    if (purchase.status === "captured") {
      tone = "notice notice--ok";
      title = `Paid ${amount} for ${purchase.title}.`;
      detail = "It passed the rules and the AI check.";
    } else if (purchase.status === "awaiting_approval") {
      tone = "notice notice--warn";
      title = `${ownerName} needs to approve ${purchase.title}.`;
      detail = `${purchaseExplanation(purchase)} Nothing is charged until ${ownerName} decides.`;
    } else if (purchase.status === "capture_unknown" || purchase.status === "capturing") {
      tone = "notice notice--warn";
      title = `Still confirming the payment for ${purchase.title}.`;
      detail = "It shows up under Your requests when PayPal answers.";
    } else {
      title = `${purchase.title} wasn't bought.`;
      detail = `${purchaseExplanation(purchase)} Nothing was charged.`;
    }
  }

  return (
    <div className={tone}>
      <span className="grow">
        <strong>{title}</strong> {detail}
      </span>
      <button type="button" className="button button--secondary button--small" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}
