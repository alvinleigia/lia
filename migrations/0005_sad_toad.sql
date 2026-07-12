CREATE TABLE "project_widget_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"allowed_domains" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_widget_keys" ADD CONSTRAINT "project_widget_keys_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_widget_keys_project_unique" ON "project_widget_keys" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_widget_keys_token_hash_unique" ON "project_widget_keys" USING btree ("token_hash");