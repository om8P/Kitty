/**
 * S19: the migrations in `drizzle/` build the database from empty, upgrade a
 * database the MVP made without losing anything, are safe to run twice, and
 * match `src/db/schema.ts`. Runs on the Docker Postgres.
 */
import { randomUUID } from "node:crypto";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import { describe, expect, it, onTestFinished } from "vitest";
import { STORES } from "@/domain/stores";
import { MVP_SCHEMA_STATEMENTS } from "./fixtures/mvp-schema";
import { runMigrations } from "./migrate";
import * as schema from "./schema";
import { TEST_SCHEMA_PREFIX, testDatabaseUrl } from "./testing-config";
import { openTestDatabase } from "./testing";

/** An empty schema on the test database, with nothing applied. Dropped when the test ends. */
async function emptySchema(): Promise<{ pool: Pool; name: string }> {
  const name = `${TEST_SCHEMA_PREFIX}${randomUUID().replace(/-/g, "")}`;
  const pool = new Pool({ connectionString: testDatabaseUrl(), max: 2, options: `-c search_path=${name}` });
  pool.on("error", () => undefined);
  await pool.query(`CREATE SCHEMA ${name}`);
  onTestFinished(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${name} CASCADE`).catch(() => undefined);
    await pool.end().catch(() => undefined);
  });
  return { pool, name };
}

/** Everything that defines the schema's shape, with the schema's own name taken out. */
async function catalog(pool: Pool, name: string) {
  const columns = await pool.query(
    `SELECT table_name, column_name, ordinal_position, data_type, is_nullable, column_default
     FROM information_schema.columns WHERE table_schema = current_schema()
     ORDER BY table_name, ordinal_position`,
  );
  const constraints = await pool.query(
    `SELECT c.conrelid::regclass::text AS table_name, c.conname, pg_get_constraintdef(c.oid) AS definition
     FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
     WHERE n.nspname = current_schema() ORDER BY 1, 2`,
  );
  const indexes = await pool.query(
    `SELECT tablename, indexname, replace(indexdef, $1, 'S') AS definition
     FROM pg_indexes WHERE schemaname = current_schema() ORDER BY 1, 2`,
    [name],
  );
  return { columns: columns.rows, constraints: constraints.rows, indexes: indexes.rows };
}

async function migrate(pool: Pool, name: string) {
  await runMigrations(pool, { migrationsSchema: name });
}

/** A small household as the MVP stored it, with allowed stores in JSONB. */
async function seedMvpData(pool: Pool) {
  await pool.query(`INSERT INTO households (id) VALUES ('h1')`);
  await pool.query(`INSERT INTO users (id, household_id, name, role) VALUES
    ('owner', 'h1', 'Sam', 'owner'), ('teen', 'h1', 'Alex', 'member')`);
  await pool.query(`INSERT INTO pools
      (id, household_id, owner_user_id, goal, status, term_days, ends_at, rail, requested_cents,
       authorized_cents, captured_cents, paypal_order_id, authorization_id, hold_expires_at, created_at)
    VALUES
      ('p-open', 'h1', 'owner', 'School supplies', 'active', 14, now() + interval '14 days', 'paypal', 15000,
       15000, 2500, 'ORDER-1', 'AUTH-1', '2026-12-01T00:00:00Z', '2026-11-02T00:00:00Z'),
      ('p-closed', 'h1', 'owner', 'Groceries', 'closed', 7, now(), 'paypal', 5000,
       5000, 0, 'ORDER-2', 'AUTH-2', '2026-11-30T00:00:00Z', '2026-11-01T00:00:00Z'),
      ('p-draft', 'h1', 'owner', 'Unapproved', 'awaiting_payer', 7, now(), 'paypal', 5000,
       0, 0, 'ORDER-3', NULL, NULL, '2026-11-01T00:00:00Z')`);
  await pool.query(`UPDATE pools SET released_cents = 5000 WHERE id = 'p-closed'`);
  await pool.query(`INSERT INTO pool_members
      (id, pool_id, kind, user_id, label, limit_cents, approval_threshold_cents, allowed_stores, captured_cents, position)
    VALUES
      ('m-teen', 'p-open', 'person', 'teen', 'Alex', 5000, 2000, '["Corner Pharmacy", "Fresh Market"]', 2500, 0),
      ('m-agent', 'p-open', 'agent', NULL, 'Helper', 3000, 1000, '["Gadget Hub"]', 0, 1)`);
  await pool.query(`INSERT INTO purchases
      (id, pool_id, member_id, product_id, product_title, store, quantity, amount_cents, status, idempotency_key, capture_id)
    VALUES ('pur-1', 'p-open', 'm-teen', 'prod-1', 'Notebooks', 'Fresh Market', 1, 2500, 'captured', 'key-1', 'CAP-1')`);
  await pool.query(`INSERT INTO ledger_entries (id, pool_id, member_id, purchase_id, kind, amount_cents) VALUES
    ('l1', 'p-open', NULL, NULL, 'authorize', 15000),
    ('l2', 'p-open', 'm-teen', 'pur-1', 'capture', 2500),
    ('l3', 'p-closed', NULL, NULL, 'void', 5000)`);
  await pool.query(`INSERT INTO usage_counters (kind, period, count) VALUES ('ai_request', '2026-11-11', 7)`);
}

/** A few rows on a migrated schema, for the constraint checks. */
async function seedMigrated(pool: Pool) {
  await pool.query(`INSERT INTO households (id) VALUES ('h1')`);
  await pool.query(`INSERT INTO users (id, household_id, name, role) VALUES ('u1', 'h1', 'Sam', 'owner')`);
  await pool.query(`INSERT INTO pools (id, household_id, owner_user_id, goal, status, term_days, ends_at, rail, requested_cents)
    VALUES ('p1', 'h1', 'u1', 'Goal', 'active', 7, now(), 'paypal', 1000)`);
  await pool.query(`INSERT INTO pool_members (id, pool_id, kind, user_id, label, limit_cents, approval_threshold_cents)
    VALUES ('m1', 'p1', 'person', 'u1', 'Sam', 500, 100)`);
  await pool.query(`INSERT INTO member_stores (member_id, store_name) VALUES ('m1', 'Fresh Market')`);
  await pool.query(`INSERT INTO purchases (id, pool_id, member_id, product_id, product_title, store, quantity, amount_cents, status, idempotency_key)
    VALUES ('pur1', 'p1', 'm1', 'x', 'Thing', 'Fresh Market', 1, 100, 'awaiting_approval', 'k1')`);
}

const TABLES: PgTable[] = Object.values(schema).filter((value: unknown) => value instanceof PgTable) as PgTable[];

describe("migrations", () => {
  it("build the schema from empty, and a second run changes nothing", async () => {
    const { pool, name } = await emptySchema();
    await migrate(pool, name);
    const first = await catalog(pool, name);
    await migrate(pool, name);
    expect(await catalog(pool, name)).toEqual(first);

    const applied = await pool.query(`SELECT count(*)::int AS n FROM __drizzle_migrations`);
    expect(applied.rows[0].n).toBe(3);
  });

  it("upgrade a database the MVP made, keeping every row, to the same schema as from empty", async () => {
    const fresh = await emptySchema();
    await migrate(fresh.pool, fresh.name);

    const old = await emptySchema();
    for (const statement of MVP_SCHEMA_STATEMENTS) await old.pool.query(statement);
    await seedMvpData(old.pool);
    const pools = (await old.pool.query(`SELECT * FROM pools ORDER BY id`)).rows;
    const purchases = (await old.pool.query(`SELECT * FROM purchases ORDER BY id`)).rows;
    const ledger = (await old.pool.query(`SELECT * FROM ledger_entries ORDER BY id`)).rows;

    await migrate(old.pool, old.name);

    expect(await catalog(old.pool, old.name)).toEqual(await catalog(fresh.pool, fresh.name));
    expect((await old.pool.query(`SELECT * FROM pools ORDER BY id`)).rows).toEqual(pools);
    expect((await old.pool.query(`SELECT * FROM ledger_entries ORDER BY id`)).rows).toEqual(ledger);
    const upgraded = (await old.pool.query(`SELECT * FROM purchases ORDER BY id`)).rows;
    expect(upgraded).toEqual(
      purchases.map((row) => ({ ...row, needs_attention: false, approval_expires_at: null, decided_by: null })),
    );
    const counter = await old.pool.query(`SELECT count FROM usage_counters WHERE kind = 'ai_request'`);
    expect(counter.rows[0].count).toBe(7);

    // Allowed stores moved to member_stores in the owner's order, and the JSONB column is gone.
    const stores = await old.pool.query(
      `SELECT member_id, store_name, position FROM member_stores ORDER BY member_id, position`,
    );
    expect(stores.rows).toEqual([
      { member_id: "m-agent", store_name: "Gadget Hub", position: 0 },
      { member_id: "m-teen", store_name: "Corner Pharmacy", position: 0 },
      { member_id: "m-teen", store_name: "Fresh Market", position: 1 },
    ]);
    const members = await old.pool.query(`SELECT id, refunded_cents, captured_cents FROM pool_members ORDER BY id`);
    expect(members.rows).toEqual([
      { id: "m-agent", refunded_cents: 0, captured_cents: 0 },
      { id: "m-teen", refunded_cents: 0, captured_cents: 2500 },
    ]);

    // Each pool's hold became its first authorization.
    const holds = await old.pool.query(
      `SELECT pool_id, paypal_authorization_id, amount_cents, status, honor_ends_at, expires_at
       FROM authorizations ORDER BY pool_id`,
    );
    expect(holds.rows).toEqual([
      {
        pool_id: "p-closed",
        paypal_authorization_id: "AUTH-2",
        amount_cents: 5000,
        status: "voided",
        honor_ends_at: new Date("2026-11-04T00:00:00Z"),
        expires_at: new Date("2026-11-30T00:00:00Z"),
      },
      {
        pool_id: "p-open",
        paypal_authorization_id: "AUTH-1",
        amount_cents: 15000,
        status: "active",
        honor_ends_at: new Date("2026-11-05T00:00:00Z"),
        expires_at: new Date("2026-12-01T00:00:00Z"),
      },
    ]);
  });

  it("match src/db/schema.ts: the same tables, columns and constraint names", async () => {
    const { pool, name } = await emptySchema();
    await migrate(pool, name);

    const tables = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = current_schema() AND table_name <> '__drizzle_migrations' ORDER BY 1`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual(TABLES.map((t) => getTableConfig(t).name).sort());

    for (const table of TABLES) {
      const config = getTableConfig(table);
      const columns = await pool.query<{ column_name: string; is_nullable: string }>(
        `SELECT column_name, is_nullable FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = $1 ORDER BY column_name`,
        [config.name],
      );
      expect(columns.rows, config.name).toEqual(
        config.columns
          .map((column) => ({ column_name: column.name, is_nullable: column.notNull ? "NO" : "YES" }))
          .sort((a, b) => a.column_name.localeCompare(b.column_name)),
      );

      const expected = [
        ...config.checks.map((c) => c.name),
        ...config.foreignKeys.map((c) => c.getName()),
        ...config.uniqueConstraints.map((c) => c.getName()),
        ...config.primaryKeys.map((c) => c.getName()),
        ...(config.columns.some((column) => column.primary) ? [`${config.name}_pkey`] : []),
      ].sort();
      const actual = await pool.query<{ conname: string }>(
        `SELECT c.conname FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
         WHERE n.nspname = current_schema() AND c.conrelid = $1::regclass AND c.contype IN ('c', 'f', 'p', 'u')`,
        [config.name],
      );
      expect(actual.rows.map((row) => row.conname).sort(), config.name).toEqual(expected);
    }
  });

  it("seed the stores table with exactly Kitty's stores, in order", async () => {
    const db = await openTestDatabase();
    const rows = await db.query<{ name: string }>("SELECT name FROM stores ORDER BY position");
    expect(rows.map((row) => row.name)).toEqual([...STORES]);
  });

  it("refuse rows that break the new tables' rules", async () => {
    const { pool, name } = await emptySchema();
    await migrate(pool, name);
    await seedMigrated(pool);

    // A member's store must be one of Kitty's stores, appear once, and belong to a real member.
    await expect(
      pool.query(`INSERT INTO member_stores (member_id, store_name) VALUES ('m1', 'Nowhere Mart')`),
    ).rejects.toThrow(/member_stores_store_name_fkey/);
    await expect(
      pool.query(`INSERT INTO member_stores (member_id, store_name) VALUES ('m1', 'Fresh Market')`),
    ).rejects.toThrow(/member_stores_pkey/);
    await expect(
      pool.query(`INSERT INTO member_stores (member_id, store_name) VALUES ('nobody', 'Gadget Hub')`),
    ).rejects.toThrow(/member_stores_member_id_fkey/);

    // A member can't have more refunded than captured, or a negative refund.
    await expect(pool.query(`UPDATE pool_members SET refunded_cents = 1 WHERE id = 'm1'`)).rejects.toThrow(
      /members_refund_within_captured/,
    );
    await expect(pool.query(`UPDATE pool_members SET refunded_cents = -1 WHERE id = 'm1'`)).rejects.toThrow(
      /pool_members_refunded_cents_check|members_refund_within_captured/,
    );

    // Authorizations: known statuses only, one row per PayPal authorization, and a real pool.
    const insertAuth = (id: string, paypalId: string, status: string, poolId = "p1") =>
      pool.query(
        `INSERT INTO authorizations (id, pool_id, paypal_authorization_id, amount_cents, honor_ends_at, expires_at, status)
         VALUES ($1, $2, $3, 100, now(), now(), $4)`,
        [id, poolId, paypalId, status],
      );
    await insertAuth("a1", "AUTH-1", "active");
    await expect(insertAuth("a2", "AUTH-2", "maybe")).rejects.toThrow(/authorizations_status_check/);
    await expect(insertAuth("a3", "AUTH-1", "active")).rejects.toThrow(/authorizations_paypal_authorization_id_key/);
    await expect(insertAuth("a4", "AUTH-4", "active", "nope")).rejects.toThrow(/authorizations_pool_id_fkey/);

    // A decision is recorded against a real user.
    await expect(pool.query(`UPDATE purchases SET decided_by = 'ghost' WHERE id = 'pur1'`)).rejects.toThrow(
      /purchases_decided_by_fkey/,
    );
  });
});
