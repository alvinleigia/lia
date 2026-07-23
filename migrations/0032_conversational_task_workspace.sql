CREATE TABLE "conversational_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"objective" text NOT NULL,
	"description" text,
	"is_archived" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "conversational_tasks" ADD CONSTRAINT "conversational_tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;

CREATE INDEX "conversational_tasks_project_idx" ON "conversational_tasks" USING btree ("project_id");
CREATE INDEX "conversational_tasks_project_archived_idx" ON "conversational_tasks" USING btree ("project_id", "is_archived");
