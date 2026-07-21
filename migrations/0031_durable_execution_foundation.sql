ALTER TABLE "action_submissions" ADD COLUMN "trace_id" text;
ALTER TABLE "action_submission_events" ADD COLUMN "trace_id" text;
ALTER TABLE "flow_runtime_commands" ADD COLUMN "trace_id" text;
ALTER TABLE "operation_attempts" ADD COLUMN "trace_id" text;

CREATE INDEX "action_submissions_trace_idx" ON "action_submissions" USING btree ("trace_id");
CREATE INDEX "action_submission_events_trace_idx" ON "action_submission_events" USING btree ("trace_id");
CREATE INDEX "flow_runtime_commands_trace_idx" ON "flow_runtime_commands" USING btree ("trace_id");
CREATE INDEX "operation_attempts_trace_idx" ON "operation_attempts" USING btree ("trace_id");

CREATE TABLE "provider_secrets" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"provider_id" integer NOT NULL,
	"secret_name" text NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"ciphertext" text NOT NULL,
	"initialization_vector" text NOT NULL,
	"authentication_tag" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "durable_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"submission_id" integer,
	"operation_attempt_id" integer,
	"job_type" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"dedupe_key" text NOT NULL,
	"trace_id" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"available_at" timestamp DEFAULT now() NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp,
	"last_error" text,
	"completed_at" timestamp,
	"cancelled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "outbox_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"durable_job_id" integer,
	"submission_id" integer,
	"operation_attempt_id" integer,
	"topic" text NOT NULL,
	"destination" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"dedupe_key" text NOT NULL,
	"trace_id" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"available_at" timestamp DEFAULT now() NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp,
	"last_error" text,
	"delivered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "provider_secrets" ADD CONSTRAINT "provider_secrets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "provider_secrets" ADD CONSTRAINT "provider_secrets_provider_id_integration_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."integration_providers"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "durable_jobs" ADD CONSTRAINT "durable_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "durable_jobs" ADD CONSTRAINT "durable_jobs_submission_id_action_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."action_submissions"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "durable_jobs" ADD CONSTRAINT "durable_jobs_operation_attempt_id_operation_attempts_id_fk" FOREIGN KEY ("operation_attempt_id") REFERENCES "public"."operation_attempts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "outbox_messages" ADD CONSTRAINT "outbox_messages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "outbox_messages" ADD CONSTRAINT "outbox_messages_durable_job_id_durable_jobs_id_fk" FOREIGN KEY ("durable_job_id") REFERENCES "public"."durable_jobs"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "outbox_messages" ADD CONSTRAINT "outbox_messages_submission_id_action_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."action_submissions"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "outbox_messages" ADD CONSTRAINT "outbox_messages_operation_attempt_id_operation_attempts_id_fk" FOREIGN KEY ("operation_attempt_id") REFERENCES "public"."operation_attempts"("id") ON DELETE no action ON UPDATE no action;

CREATE INDEX "provider_secrets_project_idx" ON "provider_secrets" USING btree ("project_id");
CREATE INDEX "provider_secrets_provider_idx" ON "provider_secrets" USING btree ("provider_id");
CREATE UNIQUE INDEX "provider_secrets_provider_name_unique" ON "provider_secrets" USING btree ("provider_id", "secret_name");
CREATE INDEX "durable_jobs_project_idx" ON "durable_jobs" USING btree ("project_id");
CREATE INDEX "durable_jobs_status_available_idx" ON "durable_jobs" USING btree ("status", "available_at");
CREATE INDEX "durable_jobs_lease_idx" ON "durable_jobs" USING btree ("lease_expires_at");
CREATE INDEX "durable_jobs_trace_idx" ON "durable_jobs" USING btree ("trace_id");
CREATE UNIQUE INDEX "durable_jobs_dedupe_unique" ON "durable_jobs" USING btree ("project_id", "job_type", "dedupe_key");
CREATE INDEX "outbox_messages_project_idx" ON "outbox_messages" USING btree ("project_id");
CREATE INDEX "outbox_messages_status_available_idx" ON "outbox_messages" USING btree ("status", "available_at");
CREATE INDEX "outbox_messages_lease_idx" ON "outbox_messages" USING btree ("lease_expires_at");
CREATE INDEX "outbox_messages_trace_idx" ON "outbox_messages" USING btree ("trace_id");
CREATE UNIQUE INDEX "outbox_messages_dedupe_unique" ON "outbox_messages" USING btree ("project_id", "topic", "dedupe_key");
