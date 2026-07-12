ALTER TABLE "action_flow_steps" ADD COLUMN "is_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX "action_flow_steps_enabled_idx" ON "action_flow_steps" USING btree ("is_enabled");
