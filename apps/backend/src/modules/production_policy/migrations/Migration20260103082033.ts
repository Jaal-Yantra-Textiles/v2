import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260103082033 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "production_run_policies" drop constraint if exists "production_run_policies_key_unique";`);
    this.addSql(`create table if not exists "production_run_policies" ("id" text not null, "key" text not null, "config" jsonb null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "production_run_policies_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_production_run_policies_key_unique" ON "production_run_policies" ("key") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_production_run_policies_deleted_at" ON "production_run_policies" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "production_run_policies" cascade;`);
  }

}
