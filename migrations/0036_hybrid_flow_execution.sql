ALTER TABLE "conversation_execution_states" ADD COLUMN "active_action_version_id" integer;

ALTER TABLE "conversation_execution_states" ADD CONSTRAINT "conversation_execution_states_active_action_version_id_action_flow_versions_id_fk" FOREIGN KEY ("active_action_version_id") REFERENCES "public"."action_flow_versions"("id") ON DELETE no action ON UPDATE no action;

CREATE INDEX "conversation_execution_states_active_action_version_idx" ON "conversation_execution_states" USING btree ("active_action_version_id");
