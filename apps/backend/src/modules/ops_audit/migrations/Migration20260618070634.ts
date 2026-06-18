import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260618070634 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "ops_maintenance_run" ("id" text not null, "job_id" text not null, "actor_id" text not null, "dry_run" boolean not null, "applied" boolean not null, "change_count" integer not null, "error_count" integer not null, "summary" text not null, "params" jsonb not null, "changes" jsonb not null, "errors" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "ops_maintenance_run_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ops_maintenance_run_deleted_at" ON "ops_maintenance_run" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "ops_maintenance_run" cascade;`);
  }

}
