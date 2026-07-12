CREATE TABLE "product_catalogs" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"provider_type" text DEFAULT 'internal' NOT NULL,
	"external_id" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_products" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"catalog_id" integer NOT NULL,
	"sku" text,
	"name" text NOT NULL,
	"description" text,
	"image_url" text,
	"product_url" text,
	"price_amount" integer,
	"currency" text,
	"status" text DEFAULT 'active' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_catalogs" ADD CONSTRAINT "product_catalogs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_products" ADD CONSTRAINT "catalog_products_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_products" ADD CONSTRAINT "catalog_products_catalog_id_product_catalogs_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."product_catalogs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_catalogs_project_idx" ON "product_catalogs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "product_catalogs_status_idx" ON "product_catalogs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "product_catalogs_provider_type_idx" ON "product_catalogs" USING btree ("provider_type");--> statement-breakpoint
CREATE UNIQUE INDEX "product_catalogs_project_name_unique" ON "product_catalogs" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX "catalog_products_project_idx" ON "catalog_products" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "catalog_products_catalog_idx" ON "catalog_products" USING btree ("catalog_id");--> statement-breakpoint
CREATE INDEX "catalog_products_status_idx" ON "catalog_products" USING btree ("status");--> statement-breakpoint
CREATE INDEX "catalog_products_sku_idx" ON "catalog_products" USING btree ("sku");
