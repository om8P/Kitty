/** The stores in Kitty's demo marketplace. Member rules allow or deny these by name. */
export const STORES = [
  "Fresh Market",
  "Corner Pharmacy",
  "Home & Garden",
  "Style Street",
  "Gadget Hub",
  "Everything Else",
] as const;

export type StoreName = (typeof STORES)[number];

export function isStore(value: unknown): value is StoreName {
  return typeof value === "string" && (STORES as readonly string[]).includes(value);
}
