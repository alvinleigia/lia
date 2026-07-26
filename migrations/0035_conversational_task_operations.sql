CREATE TABLE "conversational_task_confirmations" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"task_run_id" integer NOT NULL,
	"task_version_id" integer NOT NULL,
	"tool_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"canonical_input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"canonical_hash" text NOT NULL,
	"confirmation_token" text NOT NULL,
	"confirmed_by" jsonb,
	"expires_at" timestamp NOT NULL,
	"confirmed_at" timestamp,
	"invalidated_at" timestamp,
	"consumed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "conversational_task_tool_requests" ADD COLUMN "confirmation_id" integer;
ALTER TABLE "conversational_task_tool_requests" ADD COLUMN "outcome_key" text;
ALTER TABLE "operation_attempts" ADD COLUMN "task_run_id" integer;
ALTER TABLE "operation_attempts" ADD COLUMN "task_version_id" integer;
ALTER TABLE "operation_attempts" ADD COLUMN "task_tool_request_id" integer;
ALTER TABLE "operation_attempts" ADD COLUMN "task_confirmation_id" integer;

ALTER TABLE "conversational_task_confirmations" ADD CONSTRAINT "conversational_task_confirmations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "conversational_task_confirmations" ADD CONSTRAINT "conversational_task_confirmations_task_run_id_conversational_task_runs_id_fk" FOREIGN KEY ("task_run_id") REFERENCES "public"."conversational_task_runs"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "conversational_task_confirmations" ADD CONSTRAINT "conversational_task_confirmations_task_version_id_conversational_task_versions_id_fk" FOREIGN KEY ("task_version_id") REFERENCES "public"."conversational_task_versions"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "conversational_task_tool_requests" ADD CONSTRAINT "conversational_task_tool_requests_confirmation_id_conversational_task_confirmations_id_fk" FOREIGN KEY ("confirmation_id") REFERENCES "public"."conversational_task_confirmations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "operation_attempts" ADD CONSTRAINT "operation_attempts_task_run_id_conversational_task_runs_id_fk" FOREIGN KEY ("task_run_id") REFERENCES "public"."conversational_task_runs"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "operation_attempts" ADD CONSTRAINT "operation_attempts_task_version_id_conversational_task_versions_id_fk" FOREIGN KEY ("task_version_id") REFERENCES "public"."conversational_task_versions"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "operation_attempts" ADD CONSTRAINT "operation_attempts_task_tool_request_id_conversational_task_tool_requests_id_fk" FOREIGN KEY ("task_tool_request_id") REFERENCES "public"."conversational_task_tool_requests"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "operation_attempts" ADD CONSTRAINT "operation_attempts_task_confirmation_id_conversational_task_confirmations_id_fk" FOREIGN KEY ("task_confirmation_id") REFERENCES "public"."conversational_task_confirmations"("id") ON DELETE set null ON UPDATE no action;

CREATE INDEX "conversational_task_confirmations_project_idx" ON "conversational_task_confirmations" USING btree ("project_id");
CREATE INDEX "conversational_task_confirmations_run_idx" ON "conversational_task_confirmations" USING btree ("task_run_id");
CREATE INDEX "conversational_task_confirmations_status_idx" ON "conversational_task_confirmations" USING btree ("status");
CREATE INDEX "conversational_task_confirmations_expires_idx" ON "conversational_task_confirmations" USING btree ("expires_at");
CREATE UNIQUE INDEX "conversational_task_confirmations_token_unique" ON "conversational_task_confirmations" USING btree ("project_id", "confirmation_token");
CREATE UNIQUE INDEX "conversational_task_confirmations_active_unique" ON "conversational_task_confirmations" USING btree ("project_id", "task_run_id", "tool_id") WHERE "status" in ('pending', 'confirmed', 'executing', 'outcome_unknown');
CREATE INDEX "conversational_task_tools_confirmation_idx" ON "conversational_task_tool_requests" USING btree ("confirmation_id");
CREATE INDEX "operation_attempts_task_run_idx" ON "operation_attempts" USING btree ("task_run_id");
CREATE INDEX "operation_attempts_task_tool_request_idx" ON "operation_attempts" USING btree ("task_tool_request_id");
CREATE INDEX "operation_attempts_task_confirmation_idx" ON "operation_attempts" USING btree ("task_confirmation_id");
