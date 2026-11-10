/**
 * S11 spike: sample Channel3 search to learn its response shape.
 *
 *   npx tsx scripts/spike/channel3-sample.ts [--env <path-to-.env>] "<query>"
 *
 * - Loads the env file itself and never prints the API key.
 * - Spends at most MAX_SEARCHES searches in total, tracked in .spike-logs/.
 * - Writes each raw response to .spike-logs/ (gitignored) and prints only
 *   field paths, JSON types and counts — never product values.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MAX_SEARCHES = 5;
const SEARCH_URL = "https://api.trychannel3.com/v1/search";
const LOG_DIR = ".spike-logs";
const COUNT_FILE = join(LOG_DIR, "channel3-count.json");

type JsonType = "string" | "integer" | "number" | "boolean" | "null" | "object" | "array";

function jsonType(value: unknown): JsonType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "object") {
    return typeof value as JsonType;
  }
  return "null";
}

/** Collects every field path with the set of JSON types seen there. Array items use `[]`. */
export function describeShape(
  value: unknown,
  path = "$",
  out: Map<string, Set<JsonType>> = new Map(),
): Map<string, Set<JsonType>> {
  const types = out.get(path) ?? new Set<JsonType>();
  types.add(jsonType(value));
  out.set(path, types);
  if (Array.isArray(value)) {
    for (const item of value) describeShape(item, `${path}[]`, out);
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) describeShape(child, `${path}.${key}`, out);
  }
  return out;
}

function parseArgs(argv: string[]): { envFile: string; query: string } {
  let envFile = ".env";
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--env") envFile = argv[++i] ?? envFile;
    else rest.push(argv[i]);
  }
  const query = rest.join(" ").trim();
  if (!query) throw new Error('Usage: channel3-sample.ts [--env <path>] "<query>"');
  return { envFile, query };
}

function readCount(): number {
  if (!existsSync(COUNT_FILE)) return 0;
  const parsed: unknown = JSON.parse(readFileSync(COUNT_FILE, "utf8"));
  const used = (parsed as { used?: unknown }).used;
  return typeof used === "number" ? used : 0;
}

async function main(): Promise<void> {
  const { envFile, query } = parseArgs(process.argv.slice(2));
  if (!existsSync(envFile)) throw new Error(`Env file not found: ${envFile}`);
  process.loadEnvFile(envFile);
  const apiKey = process.env.CHANNEL3_API_KEY;
  if (!apiKey) throw new Error("CHANNEL3_API_KEY is not set in the env file.");

  mkdirSync(LOG_DIR, { recursive: true });
  const used = readCount();
  if (used >= MAX_SEARCHES) {
    throw new Error(`Search cap reached (${used}/${MAX_SEARCHES}). Not calling Channel3.`);
  }

  // Count the search before sending it, so a crash can never undercount.
  const n = used + 1;
  writeFileSync(COUNT_FILE, JSON.stringify({ used: n }));

  const res = await fetch(SEARCH_URL, {
    method: "POST",
    headers: { "x-api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({ query, limit: 5, config: { country: "US", currency: "USD" } }),
  });
  const text = await res.text();
  writeFileSync(join(LOG_DIR, `channel3-${n}.json`), text);

  console.log(`search ${n}/${MAX_SEARCHES}: HTTP ${res.status}`);
  for (const [name, value] of res.headers) {
    if (/rate|limit|credit|quota|retry|remaining/i.test(name)) {
      console.log(`header ${name}: ${/^[\d.\s,;=a-z-]*$/i.test(value) ? value : "(non-numeric, omitted)"}`);
    }
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    console.log("response is not JSON");
    return;
  }
  if (!res.ok) {
    console.log("error body shape:");
  }

  for (const [path, types] of describeShape(body)) {
    console.log(`${path}: ${[...types].sort().join(" | ")}`);
  }

  // Counts only, to judge mapping to Kitty stores and local USD prices.
  const products = (body as { products?: unknown }).products;
  if (Array.isArray(products)) {
    let offers = 0;
    let usdOffers = 0;
    let fractionalPrices = 0;
    let productsWithUsd = 0;
    const domains = new Set<string>();
    for (const p of products as Array<{ offers?: Array<Record<string, unknown>> }>) {
      let hasUsd = false;
      for (const o of p.offers ?? []) {
        offers++;
        if (typeof o.domain === "string") domains.add(o.domain);
        const price = o.price as { price?: unknown; currency?: unknown } | undefined;
        if (price?.currency === "USD") {
          usdOffers++;
          hasUsd = true;
        }
        if (typeof price?.price === "number" && !Number.isInteger(price.price)) fractionalPrices++;
      }
      if (hasUsd) productsWithUsd++;
    }
    console.log(
      `counts: products=${products.length} offers=${offers} usdOffers=${usdOffers} ` +
        `productsWithUsd=${productsWithUsd} fractionalPrices=${fractionalPrices} distinctDomains=${domains.size}`,
    );
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
