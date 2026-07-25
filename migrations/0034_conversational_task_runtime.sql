CREATE TABLE "conversational_task_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"conversation_id" integer NOT NULL,
	"task_id" integer NOT NULL,
	"task_version_id" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"current_stage" text DEFAULT 'extraction' NOT NULL,
	"outcome_key" text,
	"last_requested_field_key" text,
	"suspended_return_target" jsonb,
	"revision" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"paused_at" timestamp,
	"resume_at" timestamp,
	"expires_at" timestamp,
	"completed_at" timestamp,
	"cancelled_at" timestamp,
	"abandoned_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "conversation_execution_states" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"conversation_id" integer NOT NULL,
	"response_owner" text DEFAULT 'knowledge' NOT NULL,
	"execution_mode" text DEFAULT 'knowledge' NOT NULL,
	"active_task_run_id" integer,
	"active_task_version_id" integer,
	"active_node_id" text,
	"suspended_return_target" jsonb,
	"anonymous_visitor_id" text,
	"session_id" text NOT NULL,
	"identity_kind" text DEFAULT 'anonymous' NOT NULL,
	"channel_identity" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"verified_contact_id" integer,
	"authenticated_user_id" integer,
	"session_expires_at" timestamp,
	"session_rotated_at" timestamp,
	"last_provider_sequence" integer,
	"last_event_occurred_at" timestamp,
	"status" text DEFAULT 'active' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "conversational_task_field_values" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"task_run_id" integer NOT NULL,
	"field_id" text NOT NULL,
	"field_key" text NOT NULL,
	"field_type" text NOT NULL,
	"state" text DEFAULT 'missing' NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"sensitivity" text DEFAULT 'standard' NOT NULL,
	"natural_value" jsonb,
	"canonical_value" jsonb,
	"candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"validation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"last_requested_at" timestamp,
	"validated_at" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "conversational_task_context_values" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"task_run_id" integer NOT NULL,
	"key" text NOT NULL,
	"type" text NOT NULL,
	"source" text NOT NULL,
	"value" jsonb,
	"sensitivity" text DEFAULT 'standard' NOT NULL,
	"model_visible" boolean DEFAULT false NOT NULL,
	"tool_visible" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "conversation_inbound_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"conversation_id" integer NOT NULL,
	"task_run_id" integer,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"channel_type" text NOT NULL,
	"channel_identity" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provider_sequence" integer,
	"payload_hash" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"authentication" jsonb,
	"status" text DEFAULT 'processing' NOT NULL,
	"expected_revision" integer,
	"applied_revision" integer,
	"quarantine_reason" text,
	"occurred_at" timestamp NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "conversational_task_tool_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"task_run_id" integer NOT NULL,
	"task_version_id" integer NOT NULL,
	"request_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"tool_id" text NOT NULL,
	"stage" text NOT NULL,
	"request_mode" text DEFAULT 'synchronous' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"error_code" text,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"timeout_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "conversational_task_audit_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"conversation_id" integer NOT NULL,
	"task_run_id" integer,
	"inbound_event_id" integer,
	"event_type" text NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "conversational_task_runs" ADD CONSTRAINT "conversational_task_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "conversational_task_runs" ADD CONSTRAINT "conversational_task_runs_conversation_id_channel_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."channel_conversations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "conversational_task_runs" ADD CONSTRAINT "conversational_task_runs_task_id_conversational_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."conversational_tasks"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "conversational_task_runs" ADD CONSTRAINT "conversational_task_runs_task_version_id_conversational_task_versions_id_fk" FOREIGN KEY ("task_version_id") REFERENCES "public"."conversational_task_versions"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "conversation_execution_states" ADD CONSTRAINT "conversation_execution_states_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "conversation_execution_states" ADD CONSTRAINT "conversation_execution_states_conversation_id_channel_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."channel_conversations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "conversation_execution_states" ADD CONSTRAINT "conversation_execution_states_active_task_run_id_conversational_task_runs_id_fk" FOREIGN KEY ("active_task_run_id") REFERENCES "public"."conversational_task_runs"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "conversation_execution_states" ADD CONSTRAINT "conversation_execution_states_active_task_version_id_conversational_task_versions_id_fk" FOREIGN KEY ("active_task_version_id") REFERENCES "public"."conversational_task_versions"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "conversation_execution_states" ADD CONSTRAINT "conversation_execution_states_verified_contact_id_contacts_id_fk" FOREIGN KEY ("verified_contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "conversation_execution_states" ADD CONSTRAINT "conversation_execution_states_authenticated_user_id_users_id_fk" FOREIGN KEY ("authenticated_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "conversational_task_field_values" ADD CONSTRAINT "conversational_task_field_values_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "conversational_task_field_values" ADD CONSTRAINT "conversational_task_field_values_task_run_id_conversational_task_runs_id_fk" FOREIGN KEY ("task_run_id") REFERENCES "public"."conversational_task_runs"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "conversational_task_context_values" ADD CONSTRAINT "conversational_task_context_values_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "conversational_task_context_values" ADD CONSTRAINT "conversational_task_context_values_task_run_id_conversational_task_runs_id_fk" FOREIGN KEY ("task_run_id") REFERENCES "public"."conversational_task_runs"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "conversation_inbound_events" ADD CONSTRAINT "conversation_inbound_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "conversation_inbound_events" ADD CONSTRAINT "conversation_inbound_events_conversation_id_channel_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."channel_conversations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "conversation_inbound_events" ADD CONSTRAINT "conversation_inbound_events_task_run_id_conversational_task_runs_id_fk" FOREIGN KEY ("task_run_id") REFERENCES "public"."conversational_task_runs"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "conversational_task_tool_requests" ADD CONSTRAINT "conversational_task_tool_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "conversational_task_tool_requests" ADD CONSTRAINT "conversational_task_tool_requests_task_run_id_conversational_task_runs_id_fk" FOREIGN KEY ("task_run_id") REFERENCES "public"."conversational_task_runs"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "conversational_task_tool_requests" ADD CONSTRAINT "conversational_task_tool_requests_task_version_id_conversational_task_versions_id_fk" FOREIGN KEY ("task_version_id") REFERENCES "public"."conversational_task_versions"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "conversational_task_audit_events" ADD CONSTRAINT "conversational_task_audit_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "conversational_task_audit_events" ADD CONSTRAINT "conversational_task_audit_events_conversation_id_channel_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."channel_conversations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "conversational_task_audit_events" ADD CONSTRAINT "conversational_task_audit_events_task_run_id_conversational_task_runs_id_fk" FOREIGN KEY ("task_run_id") REFERENCES "public"."conversational_task_runs"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "conversational_task_audit_events" ADD CONSTRAINT "conversational_task_audit_events_inbound_event_id_conversation_inbound_events_id_fk" FOREIGN KEY ("inbound_event_id") REFERENCES "public"."conversation_inbound_events"("id") ON DELETE no action ON UPDATE no action;

CREATE INDEX "conversational_task_runs_project_idx" ON "conversational_task_runs" USING btree ("project_id");
CREATE INDEX "conversational_task_runs_conversation_idx" ON "conversational_task_runs" USING btree ("conversation_id");
CREATE INDEX "conversational_task_runs_task_idx" ON "conversational_task_runs" USING btree ("task_id");
CREATE INDEX "conversational_task_runs_version_idx" ON "conversational_task_runs" USING btree ("task_version_id");
CREATE INDEX "conversational_task_runs_status_idx" ON "conversational_task_runs" USING btree ("status");
CREATE INDEX "conversational_task_runs_expires_idx" ON "conversational_task_runs" USING btree ("expires_at");
CREATE UNIQUE INDEX "conversational_task_runs_active_unique" ON "conversational_task_runs" USING btree ("project_id", "conversation_id") WHERE "status" in ('active', 'paused', 'waiting', 'handoff');
CREATE INDEX "conversation_execution_states_project_idx" ON "conversation_execution_states" USING btree ("project_id");
CREATE INDEX "conversation_execution_states_conversation_idx" ON "conversation_execution_states" USING btree ("conversation_id");
CREATE INDEX "conversation_execution_states_active_run_idx" ON "conversation_execution_states" USING btree ("active_task_run_id");
CREATE INDEX "conversation_execution_states_owner_idx" ON "conversation_execution_states" USING btree ("response_owner");
CREATE INDEX "conversation_execution_states_session_expires_idx" ON "conversation_execution_states" USING btree ("session_expires_at");
CREATE UNIQUE INDEX "conversation_execution_states_conversation_unique" ON "conversation_execution_states" USING btree ("project_id", "conversation_id");
CREATE INDEX "conversational_task_fields_project_idx" ON "conversational_task_field_values" USING btree ("project_id");
CREATE INDEX "conversational_task_fields_run_idx" ON "conversational_task_field_values" USING btree ("task_run_id");
CREATE INDEX "conversational_task_fields_state_idx" ON "conversational_task_field_values" USING btree ("state");
CREATE INDEX "conversational_task_fields_expires_idx" ON "conversational_task_field_values" USING btree ("expires_at");
CREATE UNIQUE INDEX "conversational_task_fields_run_key_unique" ON "conversational_task_field_values" USING btree ("task_run_id", "field_key");
CREATE INDEX "conversational_task_context_project_idx" ON "conversational_task_context_values" USING btree ("project_id");
CREATE INDEX "conversational_task_context_run_idx" ON "conversational_task_context_values" USING btree ("task_run_id");
CREATE INDEX "conversational_task_context_expires_idx" ON "conversational_task_context_values" USING btree ("expires_at");
CREATE UNIQUE INDEX "conversational_task_context_run_key_unique" ON "conversational_task_context_values" USING btree ("task_run_id", "key");
CREATE INDEX "conversation_inbound_events_project_idx" ON "conversation_inbound_events" USING btree ("project_id");
CREATE INDEX "conversation_inbound_events_conversation_idx" ON "conversation_inbound_events" USING btree ("conversation_id");
CREATE INDEX "conversation_inbound_events_run_idx" ON "conversation_inbound_events" USING btree ("task_run_id");
CREATE INDEX "conversation_inbound_events_status_idx" ON "conversation_inbound_events" USING btree ("status");
CREATE INDEX "conversation_inbound_events_received_idx" ON "conversation_inbound_events" USING btree ("received_at");
CREATE UNIQUE INDEX "conversation_inbound_events_scope_unique" ON "conversation_inbound_events" USING btree ("project_id", "conversation_id", "event_id");
CREATE INDEX "conversational_task_tools_project_idx" ON "conversational_task_tool_requests" USING btree ("project_id");
CREATE INDEX "conversational_task_tools_run_idx" ON "conversational_task_tool_requests" USING btree ("task_run_id");
CREATE INDEX "conversational_task_tools_status_idx" ON "conversational_task_tool_requests" USING btree ("status");
CREATE INDEX "conversational_task_tools_timeout_idx" ON "conversational_task_tool_requests" USING btree ("timeout_at");
CREATE UNIQUE INDEX "conversational_task_tools_request_unique" ON "conversational_task_tool_requests" USING btree ("project_id", "request_id");
CREATE UNIQUE INDEX "conversational_task_tools_idempotency_unique" ON "conversational_task_tool_requests" USING btree ("project_id", "idempotency_key");
CREATE INDEX "conversational_task_audit_project_idx" ON "conversational_task_audit_events" USING btree ("project_id");
CREATE INDEX "conversational_task_audit_conversation_idx" ON "conversational_task_audit_events" USING btree ("conversation_id");
CREATE INDEX "conversational_task_audit_run_idx" ON "conversational_task_audit_events" USING btree ("task_run_id");
CREATE INDEX "conversational_task_audit_created_idx" ON "conversational_task_audit_events" USING btree ("created_at");
