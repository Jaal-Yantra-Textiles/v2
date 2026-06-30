import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Add fail_reason to messaging_message — the human-readable reason a WhatsApp
 * delivery failed (Meta error code/title/message), set from the status webhook
 * when a message flips to "failed". Hand-written idempotent ALTER (never edit
 * the create-table migration: it only runs on fresh DBs and would never land
 * the column on existing/prod databases).
 */
export class Migration20260630140000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "messaging_message" add column if not exists "fail_reason" text null;`
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table if exists "messaging_message" drop column if exists "fail_reason";`
    );
  }
}
