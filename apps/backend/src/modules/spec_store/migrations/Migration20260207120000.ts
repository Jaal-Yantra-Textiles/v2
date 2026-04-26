import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260207120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "spec_doc" ("id" text not null, "module_name" text not null, "spec_type" text check ("spec_type" in ('module', 'links', 'relations', 'route_plans')) not null default 'module', "content" jsonb not null, "version" text null, "generated_at" timestamptz not null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "spec_doc_pkey" primary key ("id"));`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_spec_doc_module_name_spec_type_unique" ON "spec_doc" ("module_name", "spec_type") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_spec_doc_spec_type" ON "spec_doc" ("spec_type") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_spec_doc_deleted_at" ON "spec_doc" ("deleted_at") WHERE deleted_at IS NULL;`)
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "spec_doc" cascade;`)
  }

}
