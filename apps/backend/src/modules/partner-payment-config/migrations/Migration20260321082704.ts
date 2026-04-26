import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260321082704 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "partner_payment_config" ("id" text not null, "partner_id" text not null, "provider_id" text not null, "is_active" boolean not null default true, "credentials" jsonb not null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "partner_payment_config_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_partner_payment_config_deleted_at" ON "partner_payment_config" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "partner_payment_config" cascade;`);
  }

}
