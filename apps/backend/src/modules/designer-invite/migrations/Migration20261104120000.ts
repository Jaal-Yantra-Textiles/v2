import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261104120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "design_preview_link" drop constraint if exists "design_preview_link_token_hash_unique";`);
    this.addSql(`create table if not exists "design_preview_link" ("id" text not null, "scope" text check ("scope" in ('order', 'design')) not null, "scope_id" text not null, "token_hash" text not null, "partner_id" text null, "label" text null, "expires_at" timestamptz null, "revoked_at" timestamptz null, "created_by" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "design_preview_link_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_design_preview_link_token_hash_unique" ON "design_preview_link" ("token_hash") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_design_preview_link_deleted_at" ON "design_preview_link" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "design_preview_link" cascade;`);
  }

}
