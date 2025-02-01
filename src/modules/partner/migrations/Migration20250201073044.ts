import { Migration } from '@mikro-orm/migrations';

export class Migration20250201073044 extends Migration {

  async up(): Promise<void> {
    this.addSql('create table if not exists "partner" ("id" text not null, "name" text not null, "handle" text not null, "logo" text null, "status" text check ("status" in (\'active\', \'inactive\', \'pending\')) not null default \'pending\', "is_verified" boolean not null default false, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "partner_pkey" primary key ("id"));');
    this.addSql('CREATE UNIQUE INDEX IF NOT EXISTS "IDX_partner_handle_unique" ON "partner" (handle) WHERE deleted_at IS NULL;');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_partner_deleted_at" ON "partner" (deleted_at) WHERE deleted_at IS NULL;');

    this.addSql('create table if not exists "partner_admin" ("id" text not null, "first_name" text not null, "last_name" text not null, "email" text not null, "phone" text null, "password_hash" text null, "is_active" boolean not null default true, "last_login" timestamptz null, "partner_id" text not null, "role" text check ("role" in (\'owner\', \'admin\', \'manager\')) not null default \'admin\', "permissions" jsonb null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "partner_admin_pkey" primary key ("id"));');
    this.addSql('CREATE UNIQUE INDEX IF NOT EXISTS "IDX_partner_admin_email_unique" ON "partner_admin" (email) WHERE deleted_at IS NULL;');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_partner_admin_partner_id" ON "partner_admin" (partner_id) WHERE deleted_at IS NULL;');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_partner_admin_deleted_at" ON "partner_admin" (deleted_at) WHERE deleted_at IS NULL;');

    this.addSql('alter table if exists "partner_admin" add constraint "partner_admin_partner_id_foreign" foreign key ("partner_id") references "partner" ("id") on update cascade;');
  }

  async down(): Promise<void> {
    this.addSql('alter table if exists "partner_admin" drop constraint if exists "partner_admin_partner_id_foreign";');

    this.addSql('drop table if exists "partner" cascade;');

    this.addSql('drop table if exists "partner_admin" cascade;');
  }

}
