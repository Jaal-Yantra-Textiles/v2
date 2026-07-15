import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260714192013 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "person_property" ("id" text not null, "profile_type" text not null default 'weaver', "census_id" text null, "relation_to_head" text null, "gender" text null, "social_group" text null, "religion" text null, "region_state" text null, "district" text null, "own_looms" boolean null, "total_looms_owned" integer null, "natural_dye_used" boolean null, "sells_local_market" boolean null, "sells_master_weaver" boolean null, "sells_cooperative" boolean null, "sells_ecommerce" boolean null, "support_requirements" jsonb null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "person_property_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_person_property_deleted_at" ON "person_property" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "person_property" cascade;`);
  }

}
