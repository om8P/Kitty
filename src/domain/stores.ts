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

/**
 * Selects pool members with `allowed_stores` as a text array, read from
 * `member_stores` in the owner's order, so rows keep the `MemberRow` shape.
 * Append a WHERE clause; columns of `pool_members` can be used unqualified.
 */
export const SELECT_MEMBERS = `SELECT m.*, ARRAY(
    SELECT ms.store_name FROM member_stores ms WHERE ms.member_id = m.id ORDER BY ms.position
  ) AS allowed_stores
  FROM pool_members m`;

export function isStore(value: unknown): value is StoreName {
  return typeof value === "string" && (STORES as readonly string[]).includes(value);
}
