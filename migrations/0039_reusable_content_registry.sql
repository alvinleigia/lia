CREATE TABLE "reusable_field_definitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"project_id" integer,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"field_type" text NOT NULL,
	"definition" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reusable_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"project_id" integer,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reusable_template_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_id" integer NOT NULL,
	"version_number" integer NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"compatibility" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"approved_at" timestamp,
	"approved_by_user_id" integer,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reusable_field_definitions" ADD CONSTRAINT "reusable_field_definitions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reusable_field_definitions" ADD CONSTRAINT "reusable_field_definitions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reusable_field_definitions" ADD CONSTRAINT "reusable_field_definitions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reusable_templates" ADD CONSTRAINT "reusable_templates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reusable_templates" ADD CONSTRAINT "reusable_templates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reusable_templates" ADD CONSTRAINT "reusable_templates_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reusable_template_versions" ADD CONSTRAINT "reusable_template_versions_template_id_reusable_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."reusable_templates"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reusable_template_versions" ADD CONSTRAINT "reusable_template_versions_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reusable_template_versions" ADD CONSTRAINT "reusable_template_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "reusable_field_definitions_company_idx" ON "reusable_field_definitions" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX "reusable_field_definitions_project_idx" ON "reusable_field_definitions" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX "reusable_field_definitions_status_idx" ON "reusable_field_definitions" USING btree ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX "reusable_field_definitions_company_key_unique" ON "reusable_field_definitions" USING btree ("company_id", "key") WHERE "project_id" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "reusable_field_definitions_project_key_unique" ON "reusable_field_definitions" USING btree ("project_id", "key") WHERE "project_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "reusable_templates_company_idx" ON "reusable_templates" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX "reusable_templates_project_idx" ON "reusable_templates" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX "reusable_templates_kind_idx" ON "reusable_templates" USING btree ("kind");
--> statement-breakpoint
CREATE INDEX "reusable_templates_status_idx" ON "reusable_templates" USING btree ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX "reusable_templates_company_key_unique" ON "reusable_templates" USING btree ("company_id", "kind", "key") WHERE "project_id" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "reusable_templates_project_key_unique" ON "reusable_templates" USING btree ("project_id", "kind", "key") WHERE "project_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "reusable_template_versions_template_idx" ON "reusable_template_versions" USING btree ("template_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "reusable_template_versions_template_number_unique" ON "reusable_template_versions" USING btree ("template_id", "version_number");
