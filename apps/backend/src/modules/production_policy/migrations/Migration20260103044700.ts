import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260103044700 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table if not exists "production_run_policies" ("id" text not null, "key" text not null, "config" jsonb null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "production_run_policies_pkey" primary key ("id"));`
    )
    this.addSql(
      `create unique index if not exists "IDX_production_run_policies_key" on "production_run_policies" ("key") where deleted_at is null;`
    )
    this.addSql(
      `create index if not exists "IDX_production_run_policies_deleted_at" on "production_run_policies" ("deleted_at") where deleted_at is null;`
    )
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "production_run_policies" cascade;`)
  }
}
