CREATE TABLE "hosted_voice_tool_bindings" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"deployment_id" integer NOT NULL,
	"deployment_version_id" integer NOT NULL,
	"provider" text NOT NULL,
	"credential_hash" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hosted_voice_tool_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"binding_id" integer NOT NULL,
	"provider_call_id" text NOT NULL,
	"tool_id" text NOT NULL,
	"tool_version" integer NOT NULL,
	"phase" text NOT NULL,
	"access" text NOT NULL,
	"canonical_input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"canonical_input_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"error_code" text,
	"commit_token_hash" text,
	"commit_expires_at" timestamp,
	"committed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hosted_voice_tool_bindings" ADD CONSTRAINT "hosted_voice_tool_bindings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "hosted_voice_tool_bindings" ADD CONSTRAINT "hosted_voice_tool_bindings_deployment_id_hosted_voice_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."hosted_voice_deployments"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "hosted_voice_tool_bindings" ADD CONSTRAINT "hosted_voice_tool_bindings_deployment_version_id_hosted_voice_deployment_versions_id_fk" FOREIGN KEY ("deployment_version_id") REFERENCES "public"."hosted_voice_deployment_versions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "hosted_voice_tool_calls" ADD CONSTRAINT "hosted_voice_tool_calls_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "hosted_voice_tool_calls" ADD CONSTRAINT "hosted_voice_tool_calls_binding_id_hosted_voice_tool_bindings_id_fk" FOREIGN KEY ("binding_id") REFERENCES "public"."hosted_voice_tool_bindings"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "hosted_voice_tool_bindings_project_idx" ON "hosted_voice_tool_bindings" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX "hosted_voice_tool_bindings_deployment_idx" ON "hosted_voice_tool_bindings" USING btree ("deployment_id");
--> statement-breakpoint
CREATE INDEX "hosted_voice_tool_bindings_version_idx" ON "hosted_voice_tool_bindings" USING btree ("deployment_version_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "hosted_voice_tool_bindings_credential_unique" ON "hosted_voice_tool_bindings" USING btree ("credential_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX "hosted_voice_tool_bindings_version_provider_unique" ON "hosted_voice_tool_bindings" USING btree ("deployment_version_id", "provider");
--> statement-breakpoint
CREATE INDEX "hosted_voice_tool_calls_project_idx" ON "hosted_voice_tool_calls" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX "hosted_voice_tool_calls_binding_idx" ON "hosted_voice_tool_calls" USING btree ("binding_id");
--> statement-breakpoint
CREATE INDEX "hosted_voice_tool_calls_status_idx" ON "hosted_voice_tool_calls" USING btree ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX "hosted_voice_tool_calls_provider_unique" ON "hosted_voice_tool_calls" USING btree ("binding_id", "provider_call_id");
