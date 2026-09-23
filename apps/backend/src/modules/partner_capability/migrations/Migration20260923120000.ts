import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * #2249 — a capability carries product_type, actions and source_url; `website`
 * and `records` become sources; knowledge and capability scans get their own
 * tables.
 *
 * Hand-written rather than `db:generate`d: that diffs against the local DB and
 * has emitted a `down()` dropping columns other migrations own. Additive only.
 */
export class Migration20260923120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "partner_capability_sample" add column if not exists "product_type" text null, add column if not exists "actions" jsonb null, add column if not exists "source_url" text null;`);
    this.addSql(`alter table if exists "partner_capability_sample" drop constraint if exists "partner_capability_sample_source_check";`);
    this.addSql(`alter table if exists "partner_capability_sample" add constraint "partner_capability_sample_source_check" check ("source" in ('wizard', 'assistant', 'whatsapp', 'admin', 'website', 'records'));`);

    this.addSql(`create table if not exists "partner_capability_knowledge" ("id" text not null, "partner_id" text not null, "sample_id" text null, "fact" text not null, "source" text check ("source" in ('wizard', 'assistant', 'whatsapp', 'admin', 'website', 'records')) not null default 'admin', "source_url" text null, "observed_at" timestamptz not null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "partner_capability_knowledge_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_partner_capability_knowledge_deleted_at" ON "partner_capability_knowledge" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_partner_capability_knowledge_partner" ON "partner_capability_knowledge" ("partner_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_partner_capability_knowledge_sample" ON "partner_capability_knowledge" ("sample_id") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "partner_capability_scan" ("id" text not null, "partner_id" text not null, "kind" text check ("kind" in ('website', 'records')) not null, "url" text null, "origin" text null, "platform" text check ("platform" in ('shopify', 'html', 'records')) not null, "status" text check ("status" in ('proposed', 'committed')) not null default 'proposed', "proposal" jsonb not null, "committed_at" timestamptz null, "committed_keys" jsonb null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "partner_capability_scan_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_partner_capability_scan_deleted_at" ON "partner_capability_scan" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_partner_capability_scan_partner" ON "partner_capability_scan" ("partner_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "partner_capability_scan" cascade;`);
    this.addSql(`drop table if exists "partner_capability_knowledge" cascade;`);
    // A 'website'/'records' row would violate the narrower check, so they go first.
    this.addSql(`delete from "partner_capability_sample" where "source" in ('website', 'records');`);
    this.addSql(`alter table if exists "partner_capability_sample" drop constraint if exists "partner_capability_sample_source_check";`);
    this.addSql(`alter table if exists "partner_capability_sample" add constraint "partner_capability_sample_source_check" check ("source" in ('wizard', 'assistant', 'whatsapp', 'admin'));`);
    this.addSql(`alter table if exists "partner_capability_sample" drop column if exists "product_type", drop column if exists "actions", drop column if exists "source_url";`);
  }

}
