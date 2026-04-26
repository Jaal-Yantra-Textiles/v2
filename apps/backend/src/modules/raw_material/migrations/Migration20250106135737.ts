import { Migration } from '@mikro-orm/migrations';

export class Migration20250106135737 extends Migration {

  async up(): Promise<void> {
    this.addSql('create table if not exists "is_inventory_raw_materials" ("id" text not null, "is_raw_material" boolean not null default false, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "is_inventory_raw_materials_pkey" primary key ("id"));');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_is_inventory_raw_materials_deleted_at" ON "is_inventory_raw_materials" (deleted_at) WHERE deleted_at IS NULL;');

    this.addSql('create table if not exists "material_types" ("id" text not null, "name" text not null, "description" text null, "category" text check ("category" in (\'Fiber\', \'Yarn\', \'Fabric\', \'Trim\', \'Dye\', \'Chemical\', \'Accessory\', \'Other\')) not null default \'Other\', "properties" jsonb null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "material_types_pkey" primary key ("id"));');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_material_types_deleted_at" ON "material_types" (deleted_at) WHERE deleted_at IS NULL;');

    this.addSql('create table if not exists "raw_materials" ("id" text not null, "name" text not null, "description" text not null, "composition" text not null, "specifications" jsonb null, "unit_of_measure" text check ("unit_of_measure" in (\'Meter\', \'Yard\', \'Kilogram\', \'Gram\', \'Piece\', \'Roll\', \'Other\')) not null default \'Other\', "minimum_order_quantity" integer null, "lead_time_days" integer null, "color" text null, "width" text null, "weight" text null, "grade" text null, "certification" jsonb null, "usage_guidelines" text null, "storage_requirements" text null, "status" text check ("status" in (\'Active\', \'Discontinued\', \'Under_Review\', \'Development\')) not null default \'Active\', "metadata" jsonb null, "material_type_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "raw_materials_pkey" primary key ("id"));');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_raw_materials_material_type_id" ON "raw_materials" (material_type_id) WHERE deleted_at IS NULL;');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_raw_materials_deleted_at" ON "raw_materials" (deleted_at) WHERE deleted_at IS NULL;');

    this.addSql('alter table if exists "raw_materials" add constraint "raw_materials_material_type_id_foreign" foreign key ("material_type_id") references "material_types" ("id") on update cascade;');
  }

  async down(): Promise<void> {
    this.addSql('alter table if exists "raw_materials" drop constraint if exists "raw_materials_material_type_id_foreign";');

    this.addSql('drop table if exists "is_inventory_raw_materials" cascade;');

    this.addSql('drop table if exists "material_types" cascade;');

    this.addSql('drop table if exists "raw_materials" cascade;');
  }

}
