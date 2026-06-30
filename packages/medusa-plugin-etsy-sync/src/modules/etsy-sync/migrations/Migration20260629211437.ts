import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260629211437 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "etsy_sync_account" ("id" text not null, "shop_id" text not null, "shop_name" text not null, "user_id" text null, "shop_url" text null, "currency" text null, "access_token" text not null, "refresh_token" text not null, "token_expires_at" timestamptz not null, "shop_info" jsonb null, "is_active" boolean not null default true, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "etsy_sync_account_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_etsy_sync_account_deleted_at" ON "etsy_sync_account" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "etsy_sync_batch" ("id" text not null, "transaction_id" text null, "status" text check ("status" in ('pending', 'processing', 'completed', 'failed')) not null default 'pending', "total_products" integer not null default 0, "synced_count" integer not null default 0, "failed_count" integer not null default 0, "error_log" jsonb null, "started_at" timestamptz null, "completed_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "etsy_sync_batch_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_etsy_sync_batch_deleted_at" ON "etsy_sync_batch" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "etsy_sync_record" ("id" text not null, "product_id" text not null, "account_id" text not null, "listing_id" text null, "listing_url" text null, "listing_state" text null, "action" text check ("action" in ('create', 'update', 'delete')) not null default 'create', "status" text check ("status" in ('pending', 'syncing', 'success', 'failed', 'draft')) not null default 'pending', "published" boolean not null default false, "error_message" text null, "warnings" jsonb null, "metadata" jsonb null, "synced_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "etsy_sync_record_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_etsy_sync_record_deleted_at" ON "etsy_sync_record" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "etsy_sync_settings" ("id" text not null, "account_id" text null, "default_taxonomy_id" integer null, "default_shipping_profile_id" text null, "default_return_policy_id" text null, "default_readiness_state_id" text null, "default_who_made" text not null default 'i_did', "default_when_made" text not null default 'made_to_order', "default_is_supply" boolean not null default false, "default_type" text not null default 'physical', "auto_publish" boolean not null default false, "follow_product_status" boolean not null default true, "pending_oauth" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "etsy_sync_settings_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_etsy_sync_settings_deleted_at" ON "etsy_sync_settings" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "etsy_sync_account" cascade;`);

    this.addSql(`drop table if exists "etsy_sync_batch" cascade;`);

    this.addSql(`drop table if exists "etsy_sync_record" cascade;`);

    this.addSql(`drop table if exists "etsy_sync_settings" cascade;`);
  }

}
