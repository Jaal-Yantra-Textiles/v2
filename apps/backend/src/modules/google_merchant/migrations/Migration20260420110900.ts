import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260420110900 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "google_merchant_account" ("id" text not null, "name" text not null, "merchant_id" text not null, "client_id" text not null, "client_secret" jsonb not null, "redirect_uri" text not null, "scope" text null, "access_token" text null, "refresh_token" jsonb null, "token_expires_at" timestamptz null, "account_email" text null, "is_active" boolean not null default false, "api_config" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "google_merchant_account_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_google_merchant_account_deleted_at" ON "google_merchant_account" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "google_merchant_sync_job" ("id" text not null, "transaction_id" text null, "account_id" text not null, "status" text check ("status" in ('pending', 'processing', 'completed', 'failed')) not null default 'pending', "total_products" integer not null default 0, "synced_count" integer not null default 0, "failed_count" integer not null default 0, "error_log" jsonb null, "started_at" timestamptz null, "completed_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "google_merchant_sync_job_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_google_merchant_sync_job_deleted_at" ON "google_merchant_sync_job" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "google_merchant_account" cascade;`);

    this.addSql(`drop table if exists "google_merchant_sync_job" cascade;`);
  }

}
