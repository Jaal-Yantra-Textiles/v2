import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Creates the admin_assistant_conversation table (#1092 — admin assistant chat
 * history). Mirrors partner_assistant_conversation (partner_id → user_id).
 *
 * Hand-written (Claude-owned) create migration mirroring what DML would
 * generate for the model: jsonb `messages` (default '[]') + nullable jsonb
 * `metadata`, a lookup index on user_id, and the standard deleted_at index.
 * Distinct class name + timestamp to avoid the Medusa migration-name-collision
 * hazard.
 */
export class Migration20260721181500 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "admin_assistant_conversation" ("id" text not null, "user_id" text not null, "title" text not null default 'New chat', "messages" jsonb not null default '[]', "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "admin_assistant_conversation_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_admin_assistant_conversation_user_id" ON "admin_assistant_conversation" ("user_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_admin_assistant_conversation_deleted_at" ON "admin_assistant_conversation" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "admin_assistant_conversation" cascade;`);
  }

}
