ALTER TABLE "channel_messages" ADD COLUMN IF NOT EXISTS "external_message_id" text;

CREATE UNIQUE INDEX IF NOT EXISTS "channel_messages_provider_message_unique" ON "channel_messages" USING btree ("project_id", "conversation_id", "direction", "external_message_id");
