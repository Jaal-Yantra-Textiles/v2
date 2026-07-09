import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260709154411 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`drop table if exists "faire_webhook_event" cascade;`);

    this.addSql(`alter table if exists "faire_sync_settings" add column if not exists "last_order_sync_at" timestamptz null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`create table if not exists "faire_webhook_event" ("id" text not null, "webhook_id" text not null, "event_type" text not null, "brand_id" text null, "resource_url" text null, "payload" jsonb null, "resource" jsonb null, "processed" boolean not null default false, "error" text null, "received_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "faire_webhook_event_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_faire_webhook_event_webhook_id_unique" ON "faire_webhook_event" ("webhook_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_faire_webhook_event_deleted_at" ON "faire_webhook_event" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "faire_sync_settings" drop column if exists "last_order_sync_at";`);
  }

}
