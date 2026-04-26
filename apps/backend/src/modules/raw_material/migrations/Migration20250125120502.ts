import { Migration } from '@mikro-orm/migrations';

export class Migration20250125120502 extends Migration {

  async up(): Promise<void> {
    this.addSql('drop table if exists "is_inventory_raw_materials" cascade;');
  }

  async down(): Promise<void> {
    this.addSql('create table if not exists "is_inventory_raw_materials" ("id" text not null, "is_raw_material" boolean not null default false, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "is_inventory_raw_materials_pkey" primary key ("id"));');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_is_inventory_raw_materials_deleted_at" ON "is_inventory_raw_materials" (deleted_at) WHERE deleted_at IS NULL;');
  }

}
