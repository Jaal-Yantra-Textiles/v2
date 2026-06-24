import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Creates the partner_onboarding_profile table (issue #648, slice 1).
 *
 * Hand-written (Claude-owned) create migration. Mirrors what DML would
 * generate for the model: enum columns become `text check (...)`, the
 * unique partner_id gets a partial unique index, plus the standard
 * deleted_at index.
 */
export class Migration20260624170000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "partner_onboarding_profile" ("id" text not null, "partner_id" text not null, "what_they_sell" text check ("what_they_sell" in ('apparel', 'home_textiles', 'fabric', 'yarn', 'accessories', 'other')) null, "price_range" text check ("price_range" in ('economy', 'mid', 'premium', 'luxury')) null, "has_inventory_info" boolean null, "does_stock" boolean null, "does_weaving" boolean null, "person_type" text check ("person_type" in ('individual', 'business', 'manufacturer', 'wholesaler', 'retailer', 'artisan', 'other')) null, "team_size" integer null, "payment_collection" text check ("payment_collection" in ('through_us', 'themselves')) null, "completed" boolean not null default false, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "partner_onboarding_profile_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_partner_onboarding_profile_partner_id_unique" ON "partner_onboarding_profile" ("partner_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_partner_onboarding_profile_deleted_at" ON "partner_onboarding_profile" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "partner_onboarding_profile" cascade;`);
  }

}
