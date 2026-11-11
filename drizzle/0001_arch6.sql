CREATE TABLE "authorizations" (
	"id" text PRIMARY KEY NOT NULL,
	"pool_id" text NOT NULL,
	"previous_authorization_id" text,
	"paypal_authorization_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"honor_ends_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "authorizations_paypal_authorization_id_key" UNIQUE("paypal_authorization_id"),
	CONSTRAINT "authorizations_amount_cents_check" CHECK ("authorizations"."amount_cents" >= 0),
	CONSTRAINT "authorizations_status_check" CHECK ("authorizations"."status" IN ('active', 'replaced', 'voided', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "member_stores" (
	"member_id" text NOT NULL,
	"store_name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "member_stores_pkey" PRIMARY KEY("member_id","store_name")
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"name" text PRIMARY KEY NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "stores_position_key" UNIQUE("position")
);
--> statement-breakpoint
ALTER TABLE "pool_members" ADD COLUMN "refunded_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "needs_attention" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "approval_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "decided_by" text;--> statement-breakpoint
ALTER TABLE "authorizations" ADD CONSTRAINT "authorizations_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "pools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorizations" ADD CONSTRAINT "authorizations_previous_authorization_id_fkey" FOREIGN KEY ("previous_authorization_id") REFERENCES "authorizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_stores" ADD CONSTRAINT "member_stores_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "pool_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_stores" ADD CONSTRAINT "member_stores_store_name_fkey" FOREIGN KEY ("store_name") REFERENCES "stores"("name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "authorizations_by_pool" ON "authorizations" USING btree ("pool_id","created_at");--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_members" ADD CONSTRAINT "pool_members_refunded_cents_check" CHECK ("pool_members"."refunded_cents" >= 0);--> statement-breakpoint
ALTER TABLE "pool_members" ADD CONSTRAINT "members_refund_within_captured" CHECK ("pool_members"."refunded_cents" <= "pool_members"."captured_cents");--> statement-breakpoint
-- Kitty's stores, the same list as STORES in src/domain/stores.ts (a test checks they match).
INSERT INTO "stores" ("name", "position") VALUES
  ('Fresh Market', 0),
  ('Corner Pharmacy', 1),
  ('Home & Garden', 2),
  ('Style Street', 3),
  ('Gadget Hub', 4),
  ('Everything Else', 5)
ON CONFLICT ("name") DO NOTHING;
--> statement-breakpoint
-- Move each member's allowed stores out of the JSONB column, keeping their order.
-- 0002 drops the column once this has run.
INSERT INTO "member_stores" ("member_id", "store_name", "position")
SELECT m."id", allowed."name", allowed."ordinality" - 1
FROM "pool_members" m
CROSS JOIN LATERAL jsonb_array_elements_text(m."allowed_stores") WITH ORDINALITY AS allowed("name", "ordinality")
JOIN "stores" s ON s."name" = allowed."name"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Record each pool's current hold as its first authorization. The MVP did not
-- store when the honor period ends. PayPal holds last 29 days and are honored
-- for the first 3, so it is set to 26 days before the hold expires.
INSERT INTO "authorizations" ("id", "pool_id", "paypal_authorization_id", "amount_cents", "honor_ends_at", "expires_at", "status", "created_at")
SELECT
  'auth_' || p."id",
  p."id",
  p."authorization_id",
  p."authorized_cents",
  COALESCE(p."hold_expires_at", p."created_at" + interval '29 days') - interval '26 days',
  COALESCE(p."hold_expires_at", p."created_at" + interval '29 days'),
  CASE
    WHEN p."status" IN ('active', 'closing') THEN 'active'
    WHEN EXISTS (SELECT 1 FROM "ledger_entries" l WHERE l."pool_id" = p."id" AND l."kind" = 'void') THEN 'voided'
    ELSE 'expired'
  END,
  p."created_at"
FROM "pools" p
WHERE p."authorization_id" IS NOT NULL
ON CONFLICT DO NOTHING;
