ALTER TABLE "hosted_voice_tool_calls" ADD COLUMN "provider_conversation" jsonb;
--> statement-breakpoint
ALTER TABLE "hosted_voice_tool_calls" ADD COLUMN "provider_conversation_hash" text;
--> statement-breakpoint
ALTER TABLE "hosted_voice_tool_calls" ADD COLUMN "started_at" timestamp;
--> statement-breakpoint
ALTER TABLE "hosted_voice_tool_calls" ADD COLUMN "completed_at" timestamp;
--> statement-breakpoint
ALTER TABLE "hosted_voice_tool_calls" ADD COLUMN "latency_ms" integer;
--> statement-breakpoint
ALTER TABLE "hosted_voice_tool_calls" ADD COLUMN "outcome" text;
--> statement-breakpoint
ALTER TABLE "hosted_voice_tool_calls" ADD COLUMN "interrupted_at" timestamp;
--> statement-breakpoint
ALTER TABLE "hosted_voice_tool_calls" ADD COLUMN "continuation_status" text;
--> statement-breakpoint
ALTER TABLE "hosted_voice_tool_calls" ADD COLUMN "continuation_error_code" text;
--> statement-breakpoint
ALTER TABLE "hosted_voice_tool_calls" ADD COLUMN "continuation_sent_at" timestamp;
--> statement-breakpoint
CREATE INDEX "hosted_voice_tool_calls_conversation_idx" ON "hosted_voice_tool_calls" USING btree ("project_id", "provider_conversation_hash");
--> statement-breakpoint
CREATE TABLE "hosted_voice_call_observations" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"deployment_id" integer NOT NULL,
	"deployment_version_id" integer,
	"version_attribution" text NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"provider_conversation_hash" text NOT NULL,
	"ended_at" timestamp NOT NULL,
	"duration_ms" integer NOT NULL,
	"end_reason" text NOT NULL,
	"llm_model" text NOT NULL,
	"stt_model" text NOT NULL,
	"tts_provider" text NOT NULL,
	"tts_model" text NOT NULL,
	"tool_outcome_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tool_latency_p50_ms" integer,
	"tool_latency_p95_ms" integer,
	"tool_latency_p99_ms" integer,
	"tool_interruption_count" integer DEFAULT 0 NOT NULL,
	"transferred" boolean DEFAULT false NOT NULL,
	"cost_rate_microunits_per_minute" integer NOT NULL,
	"estimated_cost_microunits" integer NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hosted_voice_call_observations" ADD CONSTRAINT "hosted_voice_call_observations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "hosted_voice_call_observations" ADD CONSTRAINT "hosted_voice_call_observations_deployment_id_hosted_voice_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."hosted_voice_deployments"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "hosted_voice_call_observations" ADD CONSTRAINT "hosted_voice_call_observations_deployment_version_id_hosted_voice_deployment_versions_id_fk" FOREIGN KEY ("deployment_version_id") REFERENCES "public"."hosted_voice_deployment_versions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "hosted_voice_call_observations_project_idx" ON "hosted_voice_call_observations" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX "hosted_voice_call_observations_deployment_idx" ON "hosted_voice_call_observations" USING btree ("deployment_id");
--> statement-breakpoint
CREATE INDEX "hosted_voice_call_observations_expires_idx" ON "hosted_voice_call_observations" USING btree ("expires_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "hosted_voice_call_observations_event_unique" ON "hosted_voice_call_observations" USING btree ("deployment_id", "provider_event_id");
