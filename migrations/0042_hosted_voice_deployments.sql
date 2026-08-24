CREATE TABLE "hosted_voice_deployments" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"provider_id" integer NOT NULL,
	"definition_key" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"remote_assistant_id" text,
	"main_remote_version_id" text,
	"candidate_remote_version_id" text,
	"rollback_remote_version_id" text,
	"main_managed_hash" text,
	"candidate_managed_hash" text,
	"observed_managed_hash" text,
	"revision" integer DEFAULT 0 NOT NULL,
	"last_inspected_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hosted_voice_deployment_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"deployment_id" integer NOT NULL,
	"definition_hash" text,
	"definition" jsonb,
	"managed_config" jsonb NOT NULL,
	"managed_hash" text NOT NULL,
	"observed_managed_hash" text NOT NULL,
	"remote_version_id" text NOT NULL,
	"status" text NOT NULL,
	"source" text DEFAULT 'lia' NOT NULL,
	"promoted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hosted_voice_deployments" ADD CONSTRAINT "hosted_voice_deployments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "hosted_voice_deployments" ADD CONSTRAINT "hosted_voice_deployments_provider_id_integration_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."integration_providers"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "hosted_voice_deployment_versions" ADD CONSTRAINT "hosted_voice_deployment_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "hosted_voice_deployment_versions" ADD CONSTRAINT "hosted_voice_deployment_versions_deployment_id_hosted_voice_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."hosted_voice_deployments"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "hosted_voice_deployments_project_idx" ON "hosted_voice_deployments" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX "hosted_voice_deployments_provider_idx" ON "hosted_voice_deployments" USING btree ("provider_id");
--> statement-breakpoint
CREATE INDEX "hosted_voice_deployments_status_idx" ON "hosted_voice_deployments" USING btree ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX "hosted_voice_deployments_scope_unique" ON "hosted_voice_deployments" USING btree ("project_id","provider_id","definition_key");
--> statement-breakpoint
CREATE INDEX "hosted_voice_deployment_versions_project_idx" ON "hosted_voice_deployment_versions" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX "hosted_voice_deployment_versions_deployment_idx" ON "hosted_voice_deployment_versions" USING btree ("deployment_id");
--> statement-breakpoint
CREATE INDEX "hosted_voice_deployment_versions_status_idx" ON "hosted_voice_deployment_versions" USING btree ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX "hosted_voice_deployment_versions_remote_unique" ON "hosted_voice_deployment_versions" USING btree ("deployment_id","remote_version_id");
