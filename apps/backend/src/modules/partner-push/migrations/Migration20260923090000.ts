import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260923090000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table if not exists "partner_push_token" ("id" text not null, "partner_id" text not null, "token" text not null, "platform" text check ("platform" in ('ios', 'android')) not null default 'ios', "app_version" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), constraint "partner_push_token_pkey" primary key ("id"));`)

    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_partner_push_token_partner_id" ON "partner_push_token" ("partner_id");`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_partner_push_token_partner_token" ON "partner_push_token" ("partner_id", "token");`)
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "partner_push_token" cascade;`)
  }
}
