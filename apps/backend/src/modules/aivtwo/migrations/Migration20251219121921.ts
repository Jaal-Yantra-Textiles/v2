import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20251219121921 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "ai_vtwo_run" drop constraint if exists "ai_vtwo_run_run_id_unique";`);
    this.addSql(`create table if not exists "ai_vtwo_run" ("id" text not null, "run_id" text not null, "resource_id" text null, "thread_id" text null, "status" text check ("status" in ('running', 'suspended', 'completed', 'error')) not null default 'running', "message" text null, "reply" text null, "steps" jsonb null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "ai_vtwo_run_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_ai_vtwo_run_run_id_unique" ON "ai_vtwo_run" ("run_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ai_vtwo_run_deleted_at" ON "ai_vtwo_run" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "ai_vtwo_run" cascade;`);
  }

}
