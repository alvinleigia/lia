CREATE TABLE "action_flow_branch_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"action_id" integer NOT NULL,
	"source_step_id" integer NOT NULL,
	"source_field_key" text NOT NULL,
	"operator" text NOT NULL,
	"comparison_value" text,
	"target_step_id" integer NOT NULL,
	"sort_order" integer NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "action_flow_branch_rules_source_sort_unique" UNIQUE("source_step_id","sort_order")
);
--> statement-breakpoint
ALTER TABLE "action_flow_branch_rules" ADD CONSTRAINT "action_flow_branch_rules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "action_flow_branch_rules" ADD CONSTRAINT "action_flow_branch_rules_action_id_project_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."project_actions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "action_flow_branch_rules" ADD CONSTRAINT "action_flow_branch_rules_source_step_id_action_flow_steps_id_fk" FOREIGN KEY ("source_step_id") REFERENCES "public"."action_flow_steps"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "action_flow_branch_rules" ADD CONSTRAINT "action_flow_branch_rules_target_step_id_action_flow_steps_id_fk" FOREIGN KEY ("target_step_id") REFERENCES "public"."action_flow_steps"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "action_flow_branch_rules_project_idx" ON "action_flow_branch_rules" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX "action_flow_branch_rules_action_idx" ON "action_flow_branch_rules" USING btree ("action_id");
--> statement-breakpoint
CREATE INDEX "action_flow_branch_rules_source_step_idx" ON "action_flow_branch_rules" USING btree ("source_step_id");
--> statement-breakpoint
CREATE INDEX "action_flow_branch_rules_target_step_idx" ON "action_flow_branch_rules" USING btree ("target_step_id");
--> statement-breakpoint
CREATE INDEX "action_flow_branch_rules_enabled_idx" ON "action_flow_branch_rules" USING btree ("is_enabled");
