ALTER TABLE "company_memberships" ALTER COLUMN "role" SET DEFAULT 'COMPANY_MEMBER';--> statement-breakpoint
ALTER TABLE "company_invitations" ALTER COLUMN "role" SET DEFAULT 'COMPANY_MEMBER';--> statement-breakpoint
UPDATE "company_invitations"
SET "role" = 'COMPANY_MEMBER', "updated_at" = now()
WHERE "status" = 'pending' AND "role" = 'COMPANY_OWNER';
