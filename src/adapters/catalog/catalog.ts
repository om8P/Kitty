/**
 * The catalog seam (architecture 3, ADR-0007).
 *
 * Channel3 supplies real products when it is configured. Every result is
 * stored in `products` under a local ID with a local price in cents, so a
 * purchase never trusts a price from the browser or from a model. Channel3's
 * terms forbid keeping its catalog, so only what a search returned is stored,
 * and anything nobody bought is deleted after 24 hours. Retailer links are
 * never stored or shown.
 */
import { z } from "zod";
import type { Catalog, CatalogProduct, Database, Queryable } from "@/domain/ports";
import type { StoreName } from "@/domain/stores";
import type { ProductRow } from "@/domain/types";
import { SEED_PRODUCTS, searchSeed, type SeedProduct } from "./seed";

const CHANNEL3_URL = "https://api.trychannel3.com/v1/search";
const CHANNEL3_TIMEOUT_MS = 12_000;
/** Channel3 gives 1,000 free searches a month. Stop well before that. */
export const CHANNEL3_MONTHLY_CAP = 900;
const MAX_PRICE_CENTS = 500_00;
const RESULT_LIMIT = 8;

type Env = Record<string, string | undefined>;

export function createCatalog(
  db: Database,
  env: Env = process.env,
  options: { fetch?: typeof fetch; now?: () => Date } = {},
): Catalog & { readonly provider: "channel3" | "seed" } {
  const apiKey = env.CHANNEL3_API_KEY?.trim();
  // `seeded` is the spelling plan.md uses, so both mean the hand-written catalog.
  const provider = env.CATALOG_PROVIDER?.trim().toLowerCase();
  const useChannel3 = Boolean(apiKey) && provider !== "seed" && provider !== "seeded";
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  let seeded: Promise<void> | undefined;

  function ensureSeeded(): Promise<void> {
    seeded ??= storeSeed(db).catch((error) => {
      seeded = undefined;
      throw error;
    });
    return seeded;
  }

  async function searchChannel3(query: string): Promise<CatalogProduct[]> {
    // Count the search only while under the cap, in one statement, so search
    // 901 never reaches Channel3 and a blocked search doesn't inflate the count.
    const period = now().toISOString().slice(0, 7);
    const counted = await db.query<{ count: number }>(
      `INSERT INTO usage_counters (kind, period, count) VALUES ('channel3_search', $1, 1)
       ON CONFLICT (kind, period) DO UPDATE SET count = usage_counters.count + 1
       WHERE usage_counters.count < $2
       RETURNING count`,
      [period, CHANNEL3_MONTHLY_CAP],
    );
    if (counted.length === 0) return [];

    const response = await fetchImpl(CHANNEL3_URL, {
      method: "POST",
      headers: { "x-api-key": apiKey as string, "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit: RESULT_LIMIT, config: { country: "US", currency: "USD" } }),
      signal: AbortSignal.timeout(CHANNEL3_TIMEOUT_MS),
    });
    if (!response.ok) return [];
    const parsed = searchResponseSchema.safeParse(await response.json());
    if (!parsed.success) return [];

    const products: CatalogProduct[] = [];
    for (const item of parsed.data.products) {
      const mapped = mapChannel3Product(item);
      if (!mapped) continue;
      const [row] = await db.query<ProductRow>(
        `INSERT INTO products (id, source, external_id, store, title, description, image_url, price_cents, fetched_at)
         VALUES ($1, 'channel3', $2, $3, $4, $5, $6, $7, now())
         ON CONFLICT (source, external_id) DO UPDATE SET
           store = EXCLUDED.store, title = EXCLUDED.title, description = EXCLUDED.description,
           image_url = EXCLUDED.image_url, price_cents = EXCLUDED.price_cents, fetched_at = now()
         RETURNING *`,
        [`c3-${item.id}`, item.id, mapped.store, mapped.title, mapped.description, mapped.imageUrl, mapped.priceCents],
      );
      products.push(toCatalogProduct(row));
    }
    return products;
  }

  return {
    provider: useChannel3 ? "channel3" : "seed",

    async search(rawQuery: string) {
      await ensureSeeded();
      const query = cleanQuery(rawQuery);
      if (!query) return [];

      let live: CatalogProduct[] = [];
      if (useChannel3) {
        try {
          await purgeUnpurchasedChannel3Products(db);
          live = await searchChannel3(query);
        } catch {
          // Any Channel3 problem falls back to the sample catalog.
          live = [];
        }
      }
      const samples = await loadSeedRows(db, searchSeed(query, live.length > 0 ? 4 : RESULT_LIMIT));
      return [...live, ...samples];
    },

    async featured() {
      await ensureSeeded();
      return loadSeedRows(db, SEED_PRODUCTS.filter((product) => product.featured));
    },
  };
}

/**
 * Removes Channel3 products nobody bought once they are a day old, because
 * Channel3's terms forbid keeping its catalog (architecture 3). Products a
 * purchase points to stay, so the ledger keeps its history. Returns how many
 * were removed. Searches call it, and the tick schedules it (S41b).
 */
export async function purgeUnpurchasedChannel3Products(db: Queryable): Promise<number> {
  const removed = await db.query<{ id: string }>(
    `DELETE FROM products
     WHERE source = 'channel3' AND fetched_at < now() - interval '24 hours'
       AND id NOT IN (SELECT product_id FROM purchases)
     RETURNING id`,
  );
  return removed.length;
}

/**
 * A search query may be shown to merchants, so it carries no identifiers:
 * emails and long digit runs are removed and the length is capped.
 */
export function cleanQuery(raw: string): string {
  return raw
    .replace(/\S+@\S+/g, " ")
    .replace(/\d{5,}/g, " ")
    .replace(/[^\p{L}\p{N}\s'&.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

const offerSchema = z.looseObject({
  price: z.looseObject({ price: z.number(), currency: z.string() }),
  availability: z.string().optional(),
  condition: z.string().nullable().optional(),
});

const channel3ProductSchema = z.looseObject({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  images: z
    .array(z.looseObject({ url: z.string(), is_main_image: z.boolean().optional() }))
    .nullable()
    .optional(),
  category: z
    .looseObject({
      slug: z.string().optional(),
      title: z.string().optional(),
      path: z.array(z.looseObject({ slug: z.string().optional(), title: z.string().optional() })).optional(),
    })
    .nullable()
    .optional(),
  offers: z.array(offerSchema).nullable().optional(),
});

const searchResponseSchema = z.looseObject({ products: z.array(channel3ProductSchema) });

type Channel3Product = z.infer<typeof channel3ProductSchema>;

/** Picks the cheapest new, in-stock USD offer. Returns null when there is none. */
export function mapChannel3Product(item: Channel3Product) {
  const prices = (item.offers ?? [])
    .filter(
      (offer) =>
        offer.price.currency === "USD" &&
        (offer.availability ?? "InStock") === "InStock" &&
        (offer.condition ?? "new") === "new",
    )
    .map((offer) => Math.round(offer.price.price * 100))
    .filter((cents) => Number.isInteger(cents) && cents > 0 && cents <= MAX_PRICE_CENTS);
  if (prices.length === 0) return null;

  const images = item.images ?? [];
  const image = images.find((entry) => entry.is_main_image) ?? images[0];
  const imageUrl = image && /^https:\/\//.test(image.url) ? image.url : null;
  const categoryText = [item.category?.slug, item.category?.title, ...(item.category?.path ?? []).map((step) => step.title)]
    .filter(Boolean)
    .join(" ");

  return {
    title: item.title.slice(0, 200),
    description: (item.description ?? "").slice(0, 600),
    imageUrl,
    priceCents: Math.min(...prices),
    store: storeForCategory(categoryText),
  };
}

const STORE_KEYWORDS: [StoreName, RegExp][] = [
  ["Gadget Hub", /electronic|computer|laptop|phone|gaming|video game|camera|audio|headphone|tablet|console/],
  ["Fresh Market", /grocer|food|beverage|drink|snack|pantry|produce|bakery|dairy|candy/],
  ["Corner Pharmacy", /health|beauty|personal care|pharmac|vitamin|skin|medicine|wellness/],
  ["Style Street", /apparel|clothing|shoe|fashion|accessor|jewel|bag|watch/],
  ["Home & Garden", /home|garden|kitchen|furniture|household|decor|tool|bedding|bath/],
];

export function storeForCategory(categoryText: string): StoreName {
  const text = categoryText.toLowerCase();
  for (const [store, pattern] of STORE_KEYWORDS) {
    if (pattern.test(text)) return store;
  }
  return "Everything Else";
}

async function storeSeed(db: Database): Promise<void> {
  for (const product of SEED_PRODUCTS) {
    await db.query(
      `INSERT INTO products (id, source, external_id, store, title, description, price_cents)
       VALUES ($1, 'seed', $2, $3, $4, $5, $6)
       ON CONFLICT (source, external_id) DO UPDATE SET
         store = EXCLUDED.store, title = EXCLUDED.title, description = EXCLUDED.description,
         price_cents = EXCLUDED.price_cents`,
      [`seed-${product.slug}`, product.slug, product.store, product.title, product.description, product.priceCents],
    );
  }
}

async function loadSeedRows(db: Database, products: SeedProduct[]): Promise<CatalogProduct[]> {
  if (products.length === 0) return [];
  const ids = products.map((product) => `seed-${product.slug}`);
  const rows = await db.query<ProductRow>("SELECT * FROM products WHERE id = ANY($1::text[])", [ids]);
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [toCatalogProduct(row)] : [];
  });
}

function toCatalogProduct(row: ProductRow): CatalogProduct {
  return {
    id: row.id,
    source: row.source,
    store: row.store,
    title: row.title,
    description: row.description,
    imageUrl: row.image_url,
    priceCents: row.price_cents,
  };
}
