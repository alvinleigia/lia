CREATE TABLE IF NOT EXISTS "integration_providers" (
  "id" serial PRIMARY KEY NOT NULL,
  "project_id" integer NOT NULL,
  "name" text NOT NULL,
  "provider_type" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "operations" (
  "id" serial PRIMARY KEY NOT NULL,
  "project_id" integer NOT NULL,
  "provider_id" integer NOT NULL,
  "name" text NOT NULL,
  "operation_type" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "input_mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "output_mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "success_step_id" integer,
  "failure_step_id" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "operation_attempts" (
  "id" serial PRIMARY KEY NOT NULL,
  "project_id" integer NOT NULL,
  "operation_id" integer NOT NULL,
  "provider_id" integer NOT NULL,
  "action_id" integer,
  "submission_id" integer,
  "status" text DEFAULT 'pending' NOT NULL,
  "request_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "response_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "error_message" text,
  "started_at" timestamp,
  "finished_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "action_flow_steps"
  ADD COLUMN IF NOT EXISTS "operation_id" integer;

DO $$ BEGIN
  ALTER TABLE "integration_providers"
    ADD CONSTRAINT "integration_providers_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id")
    ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "operations"
    ADD CONSTRAINT "operations_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id")
    ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "operations"
    ADD CONSTRAINT "operations_provider_id_integration_providers_id_fk"
    FOREIGN KEY ("provider_id") REFERENCES "public"."integration_providers"("id")
    ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "action_flow_steps"
    ADD CONSTRAINT "action_flow_steps_operation_id_operations_id_fk"
    FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id")
    ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "operation_attempts"
    ADD CONSTRAINT "operation_attempts_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id")
    ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "operation_attempts"
    ADD CONSTRAINT "operation_attempts_operation_id_operations_id_fk"
    FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id")
    ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "operation_attempts"
    ADD CONSTRAINT "operation_attempts_provider_id_integration_providers_id_fk"
    FOREIGN KEY ("provider_id") REFERENCES "public"."integration_providers"("id")
    ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "operation_attempts"
    ADD CONSTRAINT "operation_attempts_action_id_project_actions_id_fk"
    FOREIGN KEY ("action_id") REFERENCES "public"."project_actions"("id")
    ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "operation_attempts"
    ADD CONSTRAINT "operation_attempts_submission_id_action_submissions_id_fk"
    FOREIGN KEY ("submission_id") REFERENCES "public"."action_submissions"("id")
    ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "integration_providers_project_idx"
  ON "integration_providers" USING btree ("project_id");
CREATE INDEX IF NOT EXISTS "integration_providers_provider_type_idx"
  ON "integration_providers" USING btree ("provider_type");
CREATE INDEX IF NOT EXISTS "integration_providers_status_idx"
  ON "integration_providers" USING btree ("status");
CREATE INDEX IF NOT EXISTS "operations_project_idx"
  ON "operations" USING btree ("project_id");
CREATE INDEX IF NOT EXISTS "operations_provider_idx"
  ON "operations" USING btree ("provider_id");
CREATE INDEX IF NOT EXISTS "operations_operation_type_idx"
  ON "operations" USING btree ("operation_type");
CREATE INDEX IF NOT EXISTS "operations_status_idx"
  ON "operations" USING btree ("status");
CREATE INDEX IF NOT EXISTS "operation_attempts_project_idx"
  ON "operation_attempts" USING btree ("project_id");
CREATE INDEX IF NOT EXISTS "operation_attempts_operation_idx"
  ON "operation_attempts" USING btree ("operation_id");
CREATE INDEX IF NOT EXISTS "operation_attempts_provider_idx"
  ON "operation_attempts" USING btree ("provider_id");
CREATE INDEX IF NOT EXISTS "operation_attempts_action_idx"
  ON "operation_attempts" USING btree ("action_id");
CREATE INDEX IF NOT EXISTS "operation_attempts_submission_idx"
  ON "operation_attempts" USING btree ("submission_id");
CREATE INDEX IF NOT EXISTS "operation_attempts_status_idx"
  ON "operation_attempts" USING btree ("status");
CREATE INDEX IF NOT EXISTS "operation_attempts_created_at_idx"
  ON "operation_attempts" USING btree ("created_at");

INSERT INTO "integration_providers" (
  "project_id",
  "name",
  "provider_type",
  "status",
  "config",
  "updated_at"
)
SELECT
  "projects"."id",
  'Manual Review',
  'manual_review',
  'active',
  '{}'::jsonb,
  now()
FROM "projects"
WHERE NOT EXISTS (
  SELECT 1
  FROM "integration_providers"
  WHERE "integration_providers"."project_id" = "projects"."id"
    AND "integration_providers"."name" = 'Manual Review'
    AND "integration_providers"."provider_type" = 'manual_review'
);

INSERT INTO "operations" (
  "project_id",
  "provider_id",
  "name",
  "operation_type",
  "status",
  "input_mapping",
  "output_mapping",
  "settings",
  "updated_at"
)
SELECT
  "integration_providers"."project_id",
  "integration_providers"."id",
  'Manual Review',
  'manual_review',
  'active',
  '{}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb,
  now()
FROM "integration_providers"
WHERE "integration_providers"."name" = 'Manual Review'
  AND "integration_providers"."provider_type" = 'manual_review'
  AND NOT EXISTS (
    SELECT 1
    FROM "operations"
    WHERE "operations"."project_id" = "integration_providers"."project_id"
      AND "operations"."name" = 'Manual Review'
      AND "operations"."operation_type" = 'manual_review'
  );
