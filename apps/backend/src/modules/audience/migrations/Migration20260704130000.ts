import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260704130000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "audience_group" ("id" text not null, "key" text not null, "label" text not null, "kind" text check ("kind" in ('source', 'manual', 'smart')) not null default 'source', "description" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "audience_group_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_audience_group_deleted_at" ON "audience_group" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_audience_group_key" ON "audience_group" ("key") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "audience_entry" ("id" text not null, "email" text not null, "member_type" text check ("member_type" in ('person', 'customer', 'lead')) not null, "member_id" text not null, "first_name" text null, "last_name" text null, "source" text null, "groups" jsonb null, "tags" jsonb null, "mailable" boolean not null default true, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "audience_entry_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_audience_entry_deleted_at" ON "audience_entry" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_audience_entry_email" ON "audience_entry" ("email") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_audience_entry_source" ON "audience_entry" ("source") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "audience_entry" cascade;`);
    this.addSql(`drop table if exists "audience_group" cascade;`);
  }

}
