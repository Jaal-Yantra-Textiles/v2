import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260722201136 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "kit_broadcast" ("id" text not null, "page_id" text not null, "kit_broadcast_id" text not null, "recipient_count" integer not null default 0, "sent_at" timestamptz null, "stats" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "kit_broadcast_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_kit_broadcast_deleted_at" ON "kit_broadcast" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "kit_broadcast" cascade;`);
  }

}
