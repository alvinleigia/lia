CREATE TABLE "company_invitations" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"invited_by_user_id" integer,
	"accepted_by_user_id" integer,
	"email" text NOT NULL,
	"role" text DEFAULT 'COMPANY_OWNER' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"accepted_at" timestamp,
	"cancelled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "company_invitations_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "company_invitations" ADD CONSTRAINT "company_invitations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "company_invitations" ADD CONSTRAINT "company_invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "company_invitations" ADD CONSTRAINT "company_invitations_accepted_by_user_id_users_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "company_invitations_company_idx" ON "company_invitations" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX "company_invitations_email_idx" ON "company_invitations" USING btree ("email");
--> statement-breakpoint
CREATE INDEX "company_invitations_status_idx" ON "company_invitations" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "company_invitations_expires_at_idx" ON "company_invitations" USING btree ("expires_at");
