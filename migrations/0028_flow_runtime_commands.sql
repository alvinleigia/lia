CREATE TABLE "flow_runtime_commands" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"source" text NOT NULL,
	"conversation_id" text NOT NULL,
	"command_id" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"response" jsonb,
	"error_message" text,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "flow_runtime_commands" ADD CONSTRAINT "flow_runtime_commands_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "flow_runtime_commands_project_idx" ON "flow_runtime_commands" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX "flow_runtime_commands_status_idx" ON "flow_runtime_commands" USING btree ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX "flow_runtime_commands_scope_unique" ON "flow_runtime_commands" USING btree ("project_id","source","conversation_id","command_id");
