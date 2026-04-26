import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260305175038 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "hang_tag_settings" drop constraint if exists "hang_tag_settings_key_unique";`);
    this.addSql(`create table if not exists "hang_tag_settings" ("id" text not null, "key" text not null, "config" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "hang_tag_settings_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_hang_tag_settings_key_unique" ON "hang_tag_settings" ("key") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_hang_tag_settings_deleted_at" ON "hang_tag_settings" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "hang_tag_settings" cascade;`);
  }

}
