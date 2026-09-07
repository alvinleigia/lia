ALTER TABLE "google_calendar_appointments" ADD COLUMN "lookup_identity_key" text;
--> statement-breakpoint
ALTER TABLE "google_calendar_appointments" ADD COLUMN "lookup_identity_hash" text;
--> statement-breakpoint
ALTER TABLE "google_calendar_appointments" ADD COLUMN "verification_identity_hash" text;
--> statement-breakpoint
CREATE INDEX "google_calendar_appointments_lookup_identity_idx" ON "google_calendar_appointments" USING btree ("project_id", "provider_id", "lookup_identity_key", "lookup_identity_hash", "status");
