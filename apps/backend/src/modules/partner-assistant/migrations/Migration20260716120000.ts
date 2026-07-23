import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Creates the partner_assistant_conversation table (#338 item 2 — partner
 * assistant chat history).
 *
 * Hand-written (Claude-owned) create migration mirroring what DML would
 * generate for the model: jsonb `messages` (default '[]') + nullable jsonb
 * `metadata`, a lookup index on partner_id, and the standard deleted_at index.
 */
export class Migration20260716120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "partner_assistant_conversation" ("id" text not null, "partner_id" text not null, "title" text not null default 'New chat', "messages" jsonb not null default '[]', "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "partner_assistant_conversation_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_partner_assistant_conversation_partner_id" ON "partner_assistant_conversation" ("partner_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_partner_assistant_conversation_deleted_at" ON "partner_assistant_conversation" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "partner_assistant_conversation" cascade;`);
  }

}
