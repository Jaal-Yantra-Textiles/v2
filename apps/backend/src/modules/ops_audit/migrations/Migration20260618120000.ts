import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Data Plumbing v2 (#508) — additive batch-run schema.
 *
 * 1. New parent table `ops_maintenance_batch` (one row per batch run).
 * 2. Nullable `batch_id` / `job_index` on the existing `ops_maintenance_run`.
 *
 * The ALTERs are hand-written with `add column if not exists` on purpose: a new
 * column added by editing the original `create table if not exists` migration
 * never lands on a DB whose table already exists (the create-if-not-exists
 * migration hazard). A separate idempotent ALTER is the only reliable path.
 */
export class Migration20260618120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "ops_maintenance_batch" ("id" text not null, "name" text not null, "actor_id" text not null, "dry_run" boolean not null, "stop_on_error" boolean not null, "job_count" integer not null, "applied_count" integer not null, "failed_count" integer not null, "change_count" integer not null, "error_count" integer not null, "summary" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "ops_maintenance_batch_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ops_maintenance_batch_deleted_at" ON "ops_maintenance_batch" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "ops_maintenance_run" add column if not exists "batch_id" text null;`);
    this.addSql(`alter table if exists "ops_maintenance_run" add column if not exists "job_index" integer null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "ops_maintenance_run" drop column if exists "batch_id";`);
    this.addSql(`alter table if exists "ops_maintenance_run" drop column if exists "job_index";`);
    this.addSql(`drop table if exists "ops_maintenance_batch" cascade;`);
  }

}
