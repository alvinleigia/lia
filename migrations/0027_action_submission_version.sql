ALTER TABLE "action_submissions" ADD COLUMN "action_version_id" integer;
--> statement-breakpoint
UPDATE "action_submissions" AS "submission"
SET "action_version_id" = "action"."published_version_id"
FROM "project_actions" AS "action"
WHERE "submission"."action_id" = "action"."id"
  AND "submission"."status" = 'in_progress'
  AND "submission"."action_version_id" IS NULL
  AND "action"."published_version_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "action_submissions" ADD CONSTRAINT "action_submissions_action_version_id_action_flow_versions_id_fk" FOREIGN KEY ("action_version_id") REFERENCES "public"."action_flow_versions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "action_submissions_action_version_idx" ON "action_submissions" USING btree ("action_version_id");
