CREATE TABLE "chat_request_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"route" text NOT NULL,
	"project_id" integer,
	"status_code" integer NOT NULL,
	"latency_ms" integer NOT NULL,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"total_tokens" integer,
	"error_code" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_request_logs" ADD CONSTRAINT "chat_request_logs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_request_logs_created_at_idx" ON "chat_request_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "chat_request_logs_route_idx" ON "chat_request_logs" USING btree ("route");--> statement-breakpoint
CREATE INDEX "chat_request_logs_project_idx" ON "chat_request_logs" USING btree ("project_id");