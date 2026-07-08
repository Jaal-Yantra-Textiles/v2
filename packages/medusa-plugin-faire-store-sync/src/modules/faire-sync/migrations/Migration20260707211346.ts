import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260707211346 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "faire_webhook_event" drop constraint if exists "faire_webhook_event_webhook_id_unique";`);
    this.addSql(`alter table if exists "faire_order" drop constraint if exists "faire_order_order_token_unique";`);
    this.addSql(`create table if not exists "faire_order" ("id" text not null, "order_token" text not null, "order_id" text null, "status" text not null default 'created', "currency" text null, "total" text null, "buyer_name" text null, "raw" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "faire_order_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_faire_order_order_token_unique" ON "faire_order" ("order_token") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_faire_order_deleted_at" ON "faire_order" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "faire_sync_account" ("id" text not null, "brand_id" text not null, "brand_name" text not null, "currency" text null, "country" text null, "access_token" text not null, "refresh_token" text null, "token_expires_at" timestamptz null, "brand_info" jsonb null, "is_active" boolean not null default true, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "faire_sync_account_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_faire_sync_account_deleted_at" ON "faire_sync_account" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "faire_sync_batch" ("id" text not null, "transaction_id" text null, "status" text check ("status" in ('pending', 'processing', 'completed', 'failed')) not null default 'pending', "total_products" integer not null default 0, "synced_count" integer not null default 0, "failed_count" integer not null default 0, "error_log" jsonb null, "started_at" timestamptz null, "completed_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "faire_sync_batch_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_faire_sync_batch_deleted_at" ON "faire_sync_batch" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "faire_sync_record" ("id" text not null, "product_id" text not null, "account_id" text not null, "product_token" text null, "product_url" text null, "product_state" text null, "action" text check ("action" in ('create', 'update', 'delete')) not null default 'create', "status" text check ("status" in ('pending', 'syncing', 'success', 'failed', 'draft')) not null default 'pending', "published" boolean not null default false, "error_message" text null, "warnings" jsonb null, "metadata" jsonb null, "synced_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "faire_sync_record_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_faire_sync_record_deleted_at" ON "faire_sync_record" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "faire_sync_settings" ("id" text not null, "account_id" text null, "default_brand_id" text null, "default_wholesale_markup_percent" integer null, "default_min_order_quantity" integer not null default 1, "default_lead_time_days" integer null, "default_shipping_policy_id" text null, "default_category" text null, "auto_publish" boolean not null default false, "follow_product_status" boolean not null default true, "pending_oauth" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "faire_sync_settings_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_faire_sync_settings_deleted_at" ON "faire_sync_settings" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "faire_webhook_event" ("id" text not null, "webhook_id" text not null, "event_type" text not null, "brand_id" text null, "resource_url" text null, "payload" jsonb null, "resource" jsonb null, "processed" boolean not null default false, "error" text null, "received_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "faire_webhook_event_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_faire_webhook_event_webhook_id_unique" ON "faire_webhook_event" ("webhook_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_faire_webhook_event_deleted_at" ON "faire_webhook_event" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "faire_order" cascade;`);

    this.addSql(`drop table if exists "faire_sync_account" cascade;`);

    this.addSql(`drop table if exists "faire_sync_batch" cascade;`);

    this.addSql(`drop table if exists "faire_sync_record" cascade;`);

    this.addSql(`drop table if exists "faire_sync_settings" cascade;`);

    this.addSql(`drop table if exists "faire_webhook_event" cascade;`);
  }

}
