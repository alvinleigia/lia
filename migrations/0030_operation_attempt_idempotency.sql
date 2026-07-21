ALTER TABLE "operation_attempts" ADD COLUMN "idempotency_key" text;
CREATE UNIQUE INDEX "operation_attempts_idempotency_unique" ON "operation_attempts" USING btree ("project_id", "idempotency_key");
