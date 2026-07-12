CREATE TABLE "upload_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"source_document_id" integer NOT NULL,
	"text_content" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "source_documents" ADD COLUMN "processing_status" text DEFAULT 'queued' NOT NULL;--> statement-breakpoint
ALTER TABLE "source_documents" ADD COLUMN "processing_error" text;--> statement-breakpoint
ALTER TABLE "source_documents" ADD COLUMN "processed_at" timestamp;--> statement-breakpoint
ALTER TABLE "upload_jobs" ADD CONSTRAINT "upload_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_jobs" ADD CONSTRAINT "upload_jobs_source_document_id_source_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "upload_jobs_status_idx" ON "upload_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "upload_jobs_source_document_idx" ON "upload_jobs" USING btree ("source_document_id");--> statement-breakpoint
CREATE INDEX "upload_jobs_created_at_idx" ON "upload_jobs" USING btree ("created_at");