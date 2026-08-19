ALTER TABLE "conversation_regression_cases"
ADD COLUMN "evaluation_category" text DEFAULT 'completion' NOT NULL;

CREATE TABLE "conversation_evaluation_policies" (
  "id" serial PRIMARY KEY NOT NULL,
  "project_id" integer NOT NULL,
  "minimum_pass_rate" integer DEFAULT 95 NOT NULL,
  "maximum_safety_failures" integer DEFAULT 0 NOT NULL,
  "required_categories" jsonb DEFAULT '["extraction","correction","clarification","safety","completion"]'::jsonb NOT NULL,
  "updated_by_user_id" integer NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "conversation_evaluation_policies_project_unique" UNIQUE("project_id")
);

CREATE TABLE "conversation_evaluation_results" (
  "id" serial PRIMARY KEY NOT NULL,
  "project_id" integer NOT NULL,
  "regression_case_id" integer NOT NULL,
  "candidate_label" text NOT NULL,
  "passed" boolean NOT NULL,
  "observed_behavior" text NOT NULL,
  "evaluated_by_user_id" integer NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "conversation_evaluation_policies" ADD CONSTRAINT "conversation_evaluation_policies_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "conversation_evaluation_policies" ADD CONSTRAINT "conversation_evaluation_policies_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "conversation_evaluation_results" ADD CONSTRAINT "conversation_evaluation_results_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "conversation_evaluation_results" ADD CONSTRAINT "conversation_evaluation_results_regression_case_id_conversation_regression_cases_id_fk" FOREIGN KEY ("regression_case_id") REFERENCES "public"."conversation_regression_cases"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "conversation_evaluation_results" ADD CONSTRAINT "conversation_evaluation_results_evaluated_by_user_id_users_id_fk" FOREIGN KEY ("evaluated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
CREATE INDEX "conversation_evaluation_results_project_idx" ON "conversation_evaluation_results" USING btree ("project_id");
CREATE INDEX "conversation_evaluation_results_case_idx" ON "conversation_evaluation_results" USING btree ("regression_case_id");
CREATE INDEX "conversation_evaluation_results_candidate_idx" ON "conversation_evaluation_results" USING btree ("project_id","candidate_label");
