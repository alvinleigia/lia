CREATE TABLE "conversation_project_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"definition" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "conversational_tasks" ADD COLUMN "definition" jsonb DEFAULT '{}'::jsonb NOT NULL;

CREATE TABLE "conversational_task_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"task_id" integer NOT NULL,
	"version_number" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"published_by_user_id" integer,
	"published_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "conversation_project_policies" ADD CONSTRAINT "conversation_project_policies_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "conversational_task_versions" ADD CONSTRAINT "conversational_task_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "conversational_task_versions" ADD CONSTRAINT "conversational_task_versions_task_id_conversational_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."conversational_tasks"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "conversational_task_versions" ADD CONSTRAINT "conversational_task_versions_published_by_user_id_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

CREATE UNIQUE INDEX "conversation_project_policies_project_unique" ON "conversation_project_policies" USING btree ("project_id");
CREATE INDEX "conversational_task_versions_project_idx" ON "conversational_task_versions" USING btree ("project_id");
CREATE INDEX "conversational_task_versions_task_idx" ON "conversational_task_versions" USING btree ("task_id");
CREATE UNIQUE INDEX "conversational_task_versions_task_version_unique" ON "conversational_task_versions" USING btree ("task_id", "version_number");
