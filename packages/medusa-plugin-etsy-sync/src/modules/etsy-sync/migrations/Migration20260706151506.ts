import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260706151506 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "etsy_webhook_event" drop constraint if exists "etsy_webhook_event_webhook_id_unique";`);
    this.addSql(`alter table if exists "etsy_order" drop constraint if exists "etsy_order_receipt_id_unique";`);
    this.addSql(`create table if not exists "etsy_order" ("id" text not null, "receipt_id" text not null, "order_id" text null, "status" text not null default 'created', "currency" text null, "total" text null, "buyer_name" text null, "raw" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "etsy_order_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_etsy_order_receipt_id_unique" ON "etsy_order" ("receipt_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_etsy_order_deleted_at" ON "etsy_order" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "etsy_webhook_event" ("id" text not null, "webhook_id" text not null, "event_type" text not null, "shop_id" text null, "resource_url" text null, "payload" jsonb null, "resource" jsonb null, "processed" boolean not null default false, "error" text null, "received_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "etsy_webhook_event_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_etsy_webhook_event_webhook_id_unique" ON "etsy_webhook_event" ("webhook_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_etsy_webhook_event_deleted_at" ON "etsy_webhook_event" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "etsy_order" cascade;`);

    this.addSql(`drop table if exists "etsy_webhook_event" cascade;`);
  }

}
