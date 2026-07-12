CREATE TABLE "project_channels" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"channel_type" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"external_id" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"channel_id" integer,
	"channel_type" text NOT NULL,
	"external_conversation_id" text NOT NULL,
	"external_user_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_message_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"conversation_id" integer NOT NULL,
	"direction" text NOT NULL,
	"message_type" text DEFAULT 'text' NOT NULL,
	"text" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_channels" ADD CONSTRAINT "project_channels_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_conversations" ADD CONSTRAINT "channel_conversations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_conversations" ADD CONSTRAINT "channel_conversations_channel_id_project_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."project_channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_messages" ADD CONSTRAINT "channel_messages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_messages" ADD CONSTRAINT "channel_messages_conversation_id_channel_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."channel_conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_channels_project_idx" ON "project_channels" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_channels_type_idx" ON "project_channels" USING btree ("channel_type");--> statement-breakpoint
CREATE INDEX "project_channels_status_idx" ON "project_channels" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "project_channels_project_type_external_unique" ON "project_channels" USING btree ("project_id","channel_type","external_id");--> statement-breakpoint
CREATE INDEX "channel_conversations_project_idx" ON "channel_conversations" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "channel_conversations_channel_idx" ON "channel_conversations" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "channel_conversations_type_idx" ON "channel_conversations" USING btree ("channel_type");--> statement-breakpoint
CREATE INDEX "channel_conversations_status_idx" ON "channel_conversations" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_conversations_project_channel_external_unique" ON "channel_conversations" USING btree ("project_id","channel_type","external_conversation_id");--> statement-breakpoint
CREATE INDEX "channel_messages_project_idx" ON "channel_messages" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "channel_messages_conversation_idx" ON "channel_messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "channel_messages_direction_idx" ON "channel_messages" USING btree ("direction");--> statement-breakpoint
CREATE INDEX "channel_messages_created_at_idx" ON "channel_messages" USING btree ("created_at");
