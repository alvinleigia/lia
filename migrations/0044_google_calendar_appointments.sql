CREATE TABLE "google_calendar_appointments" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"provider_id" integer NOT NULL,
	"reference" text NOT NULL,
	"remote_event_id" text NOT NULL,
	"remote_etag" text NOT NULL,
	"identity_hash" text NOT NULL,
	"operation_key_hash" text NOT NULL,
	"start_at" timestamp NOT NULL,
	"end_at" timestamp NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "google_calendar_appointments" ADD CONSTRAINT "google_calendar_appointments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "google_calendar_appointments" ADD CONSTRAINT "google_calendar_appointments_provider_id_integration_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."integration_providers"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "google_calendar_appointments_project_idx" ON "google_calendar_appointments" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX "google_calendar_appointments_identity_idx" ON "google_calendar_appointments" USING btree ("project_id", "provider_id", "identity_hash", "status");
--> statement-breakpoint
CREATE INDEX "google_calendar_appointments_start_idx" ON "google_calendar_appointments" USING btree ("project_id", "provider_id", "start_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "google_calendar_appointments_reference_unique" ON "google_calendar_appointments" USING btree ("project_id", "provider_id", "reference");
--> statement-breakpoint
CREATE UNIQUE INDEX "google_calendar_appointments_remote_unique" ON "google_calendar_appointments" USING btree ("provider_id", "remote_event_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "google_calendar_appointments_operation_unique" ON "google_calendar_appointments" USING btree ("provider_id", "operation_key_hash");
