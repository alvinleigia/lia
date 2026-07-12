CREATE TABLE "companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_user_id" integer NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_memberships" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"role" text DEFAULT 'COMPANY_OWNER' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "companies_owner_idx" ON "companies" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "companies_status_idx" ON "companies" USING btree ("status");--> statement-breakpoint
CREATE INDEX "company_memberships_company_idx" ON "company_memberships" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "company_memberships_user_idx" ON "company_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "company_memberships_status_idx" ON "company_memberships" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "company_memberships_company_user_unique" ON "company_memberships" USING btree ("company_id","user_id");--> statement-breakpoint
INSERT INTO "companies" ("owner_user_id", "name", "status", "created_at", "updated_at")
SELECT DISTINCT ON ("owner_user_id")
	"owner_user_id",
	"name",
	'active',
	now(),
	now()
FROM "workspaces"
ORDER BY "owner_user_id", "id";--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "company_id" integer;--> statement-breakpoint
UPDATE "workspaces"
SET "company_id" = "companies"."id"
FROM "companies"
WHERE "workspaces"."owner_user_id" = "companies"."owner_user_id";--> statement-breakpoint
ALTER TABLE "workspaces" ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspaces_company_idx" ON "workspaces" USING btree ("company_id");--> statement-breakpoint
INSERT INTO "company_memberships" ("company_id", "user_id", "role", "status", "created_at", "updated_at")
SELECT
	"id",
	"owner_user_id",
	'COMPANY_OWNER',
	'active',
	now(),
	now()
FROM "companies";
