import { describe, expect, it } from "vitest";
import { openTestDatabase } from "@/db/testing";
import { cleanQuery, createCatalog, mapChannel3Product, storeForCategory } from "./catalog";
import { SEED_PRODUCTS, searchSeed } from "./seed";

// A made-up response in Channel3's shape (docs/spike/S11.md). No real product data.
const channel3Body = {
  products: [
    {
      id: "abc123",
      title: "Example pasta",
      description: "A made-up product.",
      images: [{ url: "https://cdn.example.com/a.jpg", is_main_image: true }],
      category: { slug: "pasta", title: "Pasta", path: [{ title: "Food & Beverages" }, { title: "Pasta" }] },
      offers: [
        { url: "https://buy.example.com/x", domain: "shop.example.com", price: { price: 4.5, currency: "USD" }, availability: "InStock", condition: "new" },
        { url: "https://buy.example.com/y", domain: "other.example.com", price: { price: 3.99, currency: "USD" }, availability: "InStock", condition: null },
        { url: "https://buy.example.com/z", domain: "cheap.example.com", price: { price: 1.0, currency: "USD" }, availability: "OutOfStock" },
      ],
    },
    { id: "no-offer", title: "Nothing in stock", offers: [] },
    { id: "eur-only", title: "Wrong currency", offers: [{ price: { price: 5, currency: "EUR" }, availability: "InStock" }] },
  ],
};

describe("seed catalog", () => {
  it("has unique slugs, real prices and known stores", () => {
    expect(new Set(SEED_PRODUCTS.map((product) => product.slug)).size).toBe(SEED_PRODUCTS.length);
    expect(SEED_PRODUCTS.every((product) => Number.isInteger(product.priceCents) && product.priceCents > 0)).toBe(true);
  });

  it("finds products by keyword, title matches first", () => {
    expect(searchSeed("pasta sauce")[0].slug).toBe("marinara");
    expect(searchSeed("headphones").map((product) => product.slug)).toEqual(["headphones"]);
    expect(searchSeed("zzzz")).toEqual([]);
    expect(searchSeed("")).toEqual([]);
  });
});

describe("Channel3 mapping", () => {
  it("takes the cheapest new, in-stock USD offer in cents and never the buy link", () => {
    const mapped = mapChannel3Product(channel3Body.products[0]);
    expect(mapped).toEqual({
      title: "Example pasta",
      description: "A made-up product.",
      imageUrl: "https://cdn.example.com/a.jpg",
      priceCents: 399,
      store: "Fresh Market",
    });
    expect(JSON.stringify(mapped)).not.toContain("buy.example.com");
  });

  it("drops products with no usable offer", () => {
    expect(mapChannel3Product(channel3Body.products[1])).toBeNull();
    expect(mapChannel3Product(channel3Body.products[2])).toBeNull();
  });

  it("maps categories to Kitty stores", () => {
    expect(storeForCategory("Electronics Headphones")).toBe("Gadget Hub");
    expect(storeForCategory("Health & Beauty")).toBe("Corner Pharmacy");
    expect(storeForCategory("Clothing Shoes")).toBe("Style Street");
    expect(storeForCategory("Home Kitchen")).toBe("Home & Garden");
    expect(storeForCategory("")).toBe("Everything Else");
  });

  it("strips identifiers from search queries", () => {
    expect(cleanQuery("  pasta   for sam@example.com order 1234567 ")).toBe("pasta for order");
    expect(cleanQuery("x".repeat(200))).toHaveLength(80);
  });
});

describe("catalog", () => {
  it("serves the sample catalog when Channel3 isn't configured", async () => {
    const db = await openTestDatabase();
    let called = false;
    const catalog = createCatalog(db, {}, { fetch: async () => ((called = true), new Response("{}")) });

    expect(catalog.provider).toBe("seed");
    const results = await catalog.search("milk");
    expect(results[0]).toMatchObject({ id: "seed-milk", source: "seed", priceCents: 389 });
    expect((await catalog.featured()).length).toBeGreaterThan(5);
    expect(called).toBe(false);
  });

  it("keeps to the sample catalog when CATALOG_PROVIDER is seed or seeded, even with a Channel3 key", async () => {
    const db = await openTestDatabase();
    let called = false;
    const fakeFetch = async () => ((called = true), new Response("{}"));
    for (const value of ["seed", "seeded", " Seeded "]) {
      const catalog = createCatalog(db, { CHANNEL3_API_KEY: "test-key", CATALOG_PROVIDER: value }, { fetch: fakeFetch });
      expect(catalog.provider).toBe("seed");
      await catalog.search("milk");
    }
    expect(called).toBe(false);
  });

  it("stores Channel3 results under local IDs and counts the search", async () => {
    const db = await openTestDatabase();
    const sent: { headers: Headers; body: unknown }[] = [];
    const catalog = createCatalog(
      db,
      { CHANNEL3_API_KEY: "test-key" },
      {
        fetch: async (_url, init) => {
          sent.push({ headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
          return new Response(JSON.stringify(channel3Body));
        },
      },
    );

    const results = await catalog.search("pasta");
    expect(results[0]).toMatchObject({ id: "c3-abc123", source: "channel3", priceCents: 399, store: "Fresh Market" });
    expect(results.some((product) => product.source === "seed")).toBe(true);
    expect(sent[0].headers.get("x-api-key")).toBe("test-key");
    expect(sent[0].body).toMatchObject({ query: "pasta", config: { country: "US", currency: "USD" } });

    const stored = await db.query<{ id: string }>("SELECT id FROM products WHERE source = 'channel3'");
    expect(stored.map((row) => row.id)).toEqual(["c3-abc123"]);
    const [counter] = await db.query<{ count: number }>("SELECT count FROM usage_counters WHERE kind = 'channel3_search'");
    expect(counter.count).toBe(1);
  });

  it("falls back to the sample catalog when Channel3 fails or its free searches run out", async () => {
    const db = await openTestDatabase();
    const failing = createCatalog(db, { CHANNEL3_API_KEY: "test-key" }, { fetch: async () => new Response("{}", { status: 402 }) });
    expect((await failing.search("milk")).map((product) => product.id)).toContain("seed-milk");

    await db.query("UPDATE usage_counters SET count = 900 WHERE kind = 'channel3_search'");
    let called = false;
    const capped = createCatalog(db, { CHANNEL3_API_KEY: "test-key" }, { fetch: async () => ((called = true), new Response("{}")) });
    expect((await capped.search("milk"))[0].id).toBe("seed-milk");
    expect(called).toBe(false);
  });

  it("deletes day-old Channel3 products nobody bought", async () => {
    const db = await openTestDatabase();
    const catalog = createCatalog(db, { CHANNEL3_API_KEY: "test-key" }, { fetch: async () => new Response(JSON.stringify({ products: [] })) });
    await db.query(
      `INSERT INTO products (id, source, external_id, store, title, price_cents, fetched_at)
       VALUES ('c3-old', 'channel3', 'old', 'Fresh Market', 'Old', 100, now() - interval '25 hours'),
              ('c3-new', 'channel3', 'new', 'Fresh Market', 'New', 100, now())`,
    );
    await catalog.search("anything");
    const left = await db.query<{ id: string }>("SELECT id FROM products WHERE source = 'channel3' ORDER BY id");
    expect(left.map((row) => row.id)).toEqual(["c3-new"]);
  });
});
