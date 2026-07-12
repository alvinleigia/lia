ALTER TABLE "project_actions" ADD COLUMN "published_version_id" integer;--> statement-breakpoint
CREATE TABLE "action_flow_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"action_id" integer NOT NULL,
	"version_number" integer NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"published_by_user_id" integer,
	"published_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "action_flow_versions" ADD CONSTRAINT "action_flow_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_flow_versions" ADD CONSTRAINT "action_flow_versions_action_id_project_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."project_actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_flow_versions" ADD CONSTRAINT "action_flow_versions_published_by_user_id_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_actions_published_version_idx" ON "project_actions" USING btree ("published_version_id");--> statement-breakpoint
CREATE INDEX "action_flow_versions_project_idx" ON "action_flow_versions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "action_flow_versions_action_idx" ON "action_flow_versions" USING btree ("action_id");--> statement-breakpoint
CREATE INDEX "action_flow_versions_status_idx" ON "action_flow_versions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "action_flow_versions_published_at_idx" ON "action_flow_versions" USING btree ("published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "action_flow_versions_action_number_unique" ON "action_flow_versions" USING btree ("action_id","version_number");
