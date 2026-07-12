CREATE TABLE "contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"display_name" text,
	"email" text,
	"phone" text,
	"status" text DEFAULT 'active' NOT NULL,
	"primary_channel_type" text NOT NULL,
	"primary_external_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_attributes" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"contact_id" integer NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"source" text DEFAULT 'flow' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_tag_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"contact_id" integer NOT NULL,
	"tag_id" integer NOT NULL,
	"source" text DEFAULT 'flow' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channel_conversations" ADD COLUMN "contact_id" integer;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_attributes" ADD CONSTRAINT "contact_attributes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_attributes" ADD CONSTRAINT "contact_attributes_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tag_assignments" ADD CONSTRAINT "contact_tag_assignments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tag_assignments" ADD CONSTRAINT "contact_tag_assignments_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tag_assignments" ADD CONSTRAINT "contact_tag_assignments_tag_id_contact_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."contact_tags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_conversations" ADD CONSTRAINT "channel_conversations_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contacts_project_idx" ON "contacts" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "contacts_status_idx" ON "contacts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "contacts_email_idx" ON "contacts" USING btree ("email");--> statement-breakpoint
CREATE INDEX "contacts_phone_idx" ON "contacts" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_project_channel_external_unique" ON "contacts" USING btree ("project_id","primary_channel_type","primary_external_id");--> statement-breakpoint
CREATE INDEX "contact_attributes_project_idx" ON "contact_attributes" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "contact_attributes_contact_idx" ON "contact_attributes" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "contact_attributes_key_idx" ON "contact_attributes" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_attributes_contact_key_unique" ON "contact_attributes" USING btree ("contact_id","key");--> statement-breakpoint
CREATE INDEX "contact_tags_project_idx" ON "contact_tags" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "contact_tags_status_idx" ON "contact_tags" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_tags_project_name_unique" ON "contact_tags" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX "contact_tag_assignments_project_idx" ON "contact_tag_assignments" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "contact_tag_assignments_contact_idx" ON "contact_tag_assignments" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "contact_tag_assignments_tag_idx" ON "contact_tag_assignments" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_tag_assignments_contact_tag_unique" ON "contact_tag_assignments" USING btree ("contact_id","tag_id");--> statement-breakpoint
CREATE INDEX "channel_conversations_contact_idx" ON "channel_conversations" USING btree ("contact_id");
