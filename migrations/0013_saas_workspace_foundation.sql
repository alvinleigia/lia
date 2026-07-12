CREATE TABLE "workspaces" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_user_id" integer NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspaces_owner_idx" ON "workspaces" USING btree ("owner_user_id");--> statement-breakpoint
INSERT INTO "workspaces" ("owner_user_id", "name", "created_at", "updated_at")
SELECT
	"id",
	CASE
		WHEN "name" IS NOT NULL AND length(trim("name")) > 0 THEN trim("name") || '''s Workspace'
		ELSE split_part("email", '@', 1) || '''s Workspace'
	END,
	now(),
	now()
FROM "users";--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "workspace_id" integer;--> statement-breakpoint
UPDATE "projects"
SET "workspace_id" = "workspaces"."id"
FROM "workspaces"
WHERE "projects"."owner_user_id" = "workspaces"."owner_user_id";--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "projects_workspace_idx" ON "projects" USING btree ("workspace_id");
