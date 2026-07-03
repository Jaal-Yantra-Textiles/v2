import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260704140000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "deployment_account" ("id" text not null, "provider" text check ("provider" in ('vercel', 'cloudflare', 'render', 'netlify')) not null, "role" text not null default 'hosting', "label" text not null, "api_config" jsonb null, "cutoff_max" integer null, "project_count" integer not null default 0, "priority" integer not null default 0, "status" text check ("status" in ('active', 'full', 'inactive')) not null default 'active', "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "deployment_account_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_deployment_account_deleted_at" ON "deployment_account" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_deployment_account_provider_status" ON "deployment_account" ("provider", "status") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "deployment_account" cascade;`);
  }

}
