import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260831062127 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "textile_analysis" ("id" text not null, "source" text check ("source" in ('internal_extraction', 'storefront_reference', 'partner_upload', 'manual')) not null default 'internal_extraction', "model_name" text null, "confidence" real null, "analyzed_at" timestamptz null, "cloth_type" text null, "category" text null, "pattern" text null, "fabric_weight" text null, "weave_or_knit" text null, "primary_color" text null, "title" text null, "description" text null, "colors" jsonb null, "season" jsonb null, "occasion" jsonb null, "seo_keywords" jsonb null, "suggested_price" jsonb null, "target_audience" text null, "care_instructions" jsonb null, "visual_observations" jsonb null, "model_characteristics" jsonb null, "raw" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "textile_analysis_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_textile_analysis_deleted_at" ON "textile_analysis" ("deleted_at") WHERE deleted_at IS NULL;`);

    /**
     * The filter columns get indexes, because being filterable is the entire
     * reason they are columns rather than keys in a JSON blob. "Show me more
     * fabrics like this" is a `WHERE cloth_type = ? AND pattern = ?` — without
     * these it is a sequential scan of every analysis ever run, and the
     * feature gets slower with exactly the success that makes it worth having.
     */
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_textile_analysis_cloth_type" ON "textile_analysis" ("cloth_type") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_textile_analysis_pattern" ON "textile_analysis" ("pattern") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_textile_analysis_fabric_weight" ON "textile_analysis" ("fabric_weight") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_textile_analysis_primary_color" ON "textile_analysis" ("primary_color") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_textile_analysis_source" ON "textile_analysis" ("source") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "textile_analysis" cascade;`);
  }

}
