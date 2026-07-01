import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * S1 of #817 — raw-material color variants.
 *
 * Adds the `raw_material_group` parent ("product") and a nullable `group_id`
 * on `raw_materials` (the per-color "variant"). Hand-written idempotent ALTER
 * because `raw_materials` already exists on live DBs (see the create-if-not-exists
 * migration hazard): editing the original create-table would never land the new
 * column on existing databases. Backfill is a no-op — existing rows stay ungrouped.
 */
export class Migration20260701120000 extends Migration {

  override async up(): Promise<void> {
    // Parent "product" table grouping per-color raw_material rows.
    this.addSql(`create table if not exists "raw_material_group" ("id" text not null, "name" text not null, "description" text null, "composition" text null, "specifications" jsonb null, "unit_of_measure" text check ("unit_of_measure" in ('Meter', 'Yard', 'Kilogram', 'Gram', 'Piece', 'Roll', 'Other')) not null default 'Other', "status" text check ("status" in ('Active', 'Discontinued', 'Under_Review', 'Development')) not null default 'Active', "metadata" jsonb null, "media" jsonb null, "material_type_id" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "raw_material_group_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_raw_material_group_material_type_id" ON "raw_material_group" (material_type_id) WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_raw_material_group_deleted_at" ON "raw_material_group" (deleted_at) WHERE deleted_at IS NULL;`);
    this.addSql(`alter table if exists "raw_material_group" drop constraint if exists "raw_material_group_material_type_id_foreign";`);
    this.addSql(`alter table if exists "raw_material_group" add constraint "raw_material_group_material_type_id_foreign" foreign key ("material_type_id") references "material_types" ("id") on update cascade on delete set null;`);

    // Link each per-color raw_material to its group (nullable; existing rows stay ungrouped).
    this.addSql(`alter table if exists "raw_materials" add column if not exists "group_id" text null;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_raw_materials_group_id" ON "raw_materials" (group_id) WHERE deleted_at IS NULL;`);
    this.addSql(`alter table if exists "raw_materials" drop constraint if exists "raw_materials_group_id_foreign";`);
    this.addSql(`alter table if exists "raw_materials" add constraint "raw_materials_group_id_foreign" foreign key ("group_id") references "raw_material_group" ("id") on update cascade on delete set null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "raw_materials" drop constraint if exists "raw_materials_group_id_foreign";`);
    this.addSql(`drop index if exists "IDX_raw_materials_group_id";`);
    this.addSql(`alter table if exists "raw_materials" drop column if exists "group_id";`);
    this.addSql(`drop table if exists "raw_material_group" cascade;`);
  }

}
