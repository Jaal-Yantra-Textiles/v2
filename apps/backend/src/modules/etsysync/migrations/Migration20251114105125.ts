import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20251114105125 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "etsy_account" ("id" text not null, "shop_id" text not null, "shop_name" text not null, "access_token" text not null, "refresh_token" text not null, "token_expires_at" timestamptz not null, "api_config" jsonb not null, "is_active" boolean not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "etsy_account_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_etsy_account_deleted_at" ON "etsy_account" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "etsy_account" cascade;`);
  }

}
