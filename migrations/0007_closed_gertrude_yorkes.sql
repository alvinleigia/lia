CREATE TABLE "widget_rate_limits" (
	"id" serial PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"client_ip" text NOT NULL,
	"window_start" timestamp NOT NULL,
	"request_count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "widget_rate_limits_unique_window" ON "widget_rate_limits" USING btree ("token_hash","client_ip","window_start");--> statement-breakpoint
CREATE INDEX "widget_rate_limits_token_hash_idx" ON "widget_rate_limits" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "widget_rate_limits_updated_at_idx" ON "widget_rate_limits" USING btree ("updated_at");