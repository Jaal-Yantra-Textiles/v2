import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * #2596 — per-technique rate estimates on a partner's capabilities, and the
 * sample's technique mapped onto the platform vocabulary.
 *
 * Hand-written (db:generate diffs against the local DB). Additive only.
 */
export class Migration20261124120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "partner_capability_sample" add column if not exists "technique_slug" text null;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_partner_capability_sample_technique_slug" ON "partner_capability_sample" ("technique_slug") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "partner_capability_rate" ("id" text not null, "partner_id" text not null, "technique" text not null, "sample_id" text null, "unit" text check ("unit" in ('piece', 'metre', 'sq_inch', 'colour', 'hour', 'kg', 'set')) not null default 'piece', "min_qty" integer null, "max_qty" integer null, "currency_code" text not null default 'inr', "price_low" numeric not null, "price_high" numeric null, "setup_fee" numeric null, "lead_days" integer null, "tax_basis" text check ("tax_basis" in ('gst_exclusive', 'gst_inclusive', 'unknown')) not null default 'unknown', "source" text check ("source" in ('partner_quoted', 'admin_estimate', 'from_past_runs')) not null default 'admin_estimate', "status" text check ("status" in ('proposed', 'confirmed')) not null default 'confirmed', "observed_at" timestamptz not null, "notes" text null, "metadata" jsonb null, "raw_price_low" jsonb not null, "raw_price_high" jsonb null, "raw_setup_fee" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "partner_capability_rate_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_partner_capability_rate_deleted_at" ON "partner_capability_rate" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_partner_capability_rate_partner" ON "partner_capability_rate" ("partner_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_partner_capability_rate_technique" ON "partner_capability_rate" ("technique") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "partner_capability_rate" cascade;`);
    this.addSql(`drop index if exists "idx_partner_capability_sample_technique_slug";`);
    this.addSql(`alter table if exists "partner_capability_sample" drop column if exists "technique_slug";`);
  }

}
