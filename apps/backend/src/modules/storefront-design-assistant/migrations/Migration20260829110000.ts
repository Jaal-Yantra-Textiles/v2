import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Creates the storefront_design_conversation table (chat design editor —
 * per-design chat history).
 *
 * Hand-written create migration mirroring what DML would generate for the
 * model (same pattern as admin_assistant_conversation #1092): jsonb `messages`
 * (default '[]'), nullable jsonb `metadata`, nullable `design_id` (threads
 * start before the design row exists — design created at first generation),
 * lookup index on (customer_email, thread_key) + design_id, standard
 * deleted_at index. Distinct class name + timestamp to avoid the Medusa
 * migration-name-collision hazard.
 */
export class Migration20260829110000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "storefront_design_conversation" ("id" text not null, "customer_email" text not null, "design_id" text null, "thread_key" text not null, "title" text not null default 'New chat', "messages" jsonb not null default '[]', "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "storefront_design_conversation_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_storefront_design_conversation_email_thread" ON "storefront_design_conversation" ("customer_email", "thread_key") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_storefront_design_conversation_design_id" ON "storefront_design_conversation" ("design_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_storefront_design_conversation_deleted_at" ON "storefront_design_conversation" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "storefront_design_conversation" cascade;`);
  }

}
