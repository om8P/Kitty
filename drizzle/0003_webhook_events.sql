CREATE TABLE "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"paypal_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"note" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "webhook_events_paypal_event_id_key" UNIQUE("paypal_event_id"),
	CONSTRAINT "webhook_events_status_check" CHECK ("webhook_events"."status" IN ('processed', 'unmatched', 'contradiction')),
	CONSTRAINT "webhook_events_attempts_check" CHECK ("webhook_events"."attempts" >= 1)
);
--> statement-breakpoint
CREATE INDEX "webhook_events_unmatched" ON "webhook_events" USING btree ("received_at") WHERE status = 'unmatched';