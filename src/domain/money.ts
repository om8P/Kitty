/** Money is integer cents, USD only. */

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function formatUsd(cents: number): string {
  return usd.format(cents / 100);
}

/** The decimal string PayPal expects, for example "12.50". */
export function toDecimalString(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Parses user input such as "150", "150.5" or "$1,200.00". Returns null if it isn't a clean amount. */
export function parseDollars(input: string): number | null {
  const cleaned = input.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

/** Converts a decimal dollar amount from an API to cents, or null if it isn't a positive number. */
export function decimalToCents(value: unknown): number | null {
  const number = typeof value === "string" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isFinite(number) || number <= 0) return null;
  return Math.round(number * 100);
}
