import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260825011618 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "partner_capability_sample" ("id" text not null, "partner_id" text not null, "title" text not null, "technique" text null, "material" text null, "media_file_ids" jsonb null, "notes" text null, "source" text check ("source" in ('wizard', 'assistant', 'whatsapp', 'admin')) not null default 'admin', "captured_at" timestamptz not null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "partner_capability_sample_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_partner_capability_sample_deleted_at" ON "partner_capability_sample" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_partner_capability_sample_partner" ON "partner_capability_sample" ("partner_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "partner_capability_sample" cascade;`);
  }

}
