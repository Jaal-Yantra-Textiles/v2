import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20251114105619 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "etsy_sync_job" ("id" text not null, "transaction_id" text not null, "status" text check ("status" in ('pending', 'confirmed', 'processing', 'completed', 'failed')) not null, "total_products" integer not null, "synced_count" integer not null, "failed_count" integer not null, "error_log" jsonb not null, "started_at" timestamptz not null, "completed_at" timestamptz not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "etsy_sync_job_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_etsy_sync_job_deleted_at" ON "etsy_sync_job" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "etsy_sync_job" cascade;`);
  }

}
