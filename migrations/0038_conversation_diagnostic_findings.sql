CREATE TABLE "conversation_diagnostic_findings" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"conversation_id" integer NOT NULL,
	"author_user_id" integer NOT NULL,
	"category" text NOT NULL,
	"note" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_regression_cases" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"source_finding_id" integer NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"title" text NOT NULL,
	"synthetic_input" text NOT NULL,
	"expected_behavior" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_diagnostic_findings" ADD CONSTRAINT "conversation_diagnostic_findings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "conversation_diagnostic_findings" ADD CONSTRAINT "conversation_diagnostic_findings_conversation_id_channel_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."channel_conversations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "conversation_diagnostic_findings" ADD CONSTRAINT "conversation_diagnostic_findings_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "conversation_regression_cases" ADD CONSTRAINT "conversation_regression_cases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "conversation_regression_cases" ADD CONSTRAINT "conversation_regression_cases_source_finding_id_conversation_diagnostic_findings_id_fk" FOREIGN KEY ("source_finding_id") REFERENCES "public"."conversation_diagnostic_findings"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "conversation_regression_cases" ADD CONSTRAINT "conversation_regression_cases_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "conversation_diagnostic_findings_project_idx" ON "conversation_diagnostic_findings" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX "conversation_diagnostic_findings_conversation_idx" ON "conversation_diagnostic_findings" USING btree ("conversation_id");
--> statement-breakpoint
CREATE INDEX "conversation_diagnostic_findings_created_at_idx" ON "conversation_diagnostic_findings" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX "conversation_regression_cases_project_idx" ON "conversation_regression_cases" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX "conversation_regression_cases_status_idx" ON "conversation_regression_cases" USING btree ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_regression_cases_source_finding_unique" ON "conversation_regression_cases" USING btree ("source_finding_id");
