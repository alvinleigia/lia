CREATE TABLE "action_flow_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"action_id" integer NOT NULL,
	"sort_order" integer NOT NULL,
	"step_type" text NOT NULL,
	"field_key" text,
	"label" text,
	"prompt" text,
	"input_type" text,
	"is_required" boolean DEFAULT false NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"next_step_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "action_submission_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"submission_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"message" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "action_submissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"action_id" integer NOT NULL,
	"current_step_id" integer,
	"conversation_id" text,
	"source" text DEFAULT 'chat_widget' NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"submitted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"trigger_phrases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "action_flow_steps" ADD CONSTRAINT "action_flow_steps_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_flow_steps" ADD CONSTRAINT "action_flow_steps_action_id_project_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."project_actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_submission_events" ADD CONSTRAINT "action_submission_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_submission_events" ADD CONSTRAINT "action_submission_events_submission_id_action_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."action_submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_submissions" ADD CONSTRAINT "action_submissions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_submissions" ADD CONSTRAINT "action_submissions_action_id_project_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."project_actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_actions" ADD CONSTRAINT "project_actions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "action_flow_steps_project_idx" ON "action_flow_steps" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "action_flow_steps_action_idx" ON "action_flow_steps" USING btree ("action_id");--> statement-breakpoint
CREATE UNIQUE INDEX "action_flow_steps_action_sort_unique" ON "action_flow_steps" USING btree ("action_id","sort_order");--> statement-breakpoint
CREATE INDEX "action_submission_events_project_idx" ON "action_submission_events" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "action_submission_events_submission_idx" ON "action_submission_events" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "action_submission_events_created_at_idx" ON "action_submission_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "action_submissions_project_idx" ON "action_submissions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "action_submissions_action_idx" ON "action_submissions" USING btree ("action_id");--> statement-breakpoint
CREATE INDEX "action_submissions_status_idx" ON "action_submissions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "action_submissions_created_at_idx" ON "action_submissions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "project_actions_project_idx" ON "project_actions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_actions_status_idx" ON "project_actions" USING btree ("status");