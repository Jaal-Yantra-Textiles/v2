import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Add default_sender_platform_id to messaging_conversation for multi-number
 * WhatsApp support. Each conversation can be pinned to a specific WhatsApp
 * SocialPlatform row so replies go out from the right sender. Null means
 * "use the default WhatsApp platform".
 */
export class Migration20260418010000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "messaging_conversation" add column if not exists "default_sender_platform_id" text null;`
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_messaging_conversation_default_sender_platform_id" ON "messaging_conversation" ("default_sender_platform_id") WHERE deleted_at IS NULL;`
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `drop index if exists "IDX_messaging_conversation_default_sender_platform_id";`
    );
    this.addSql(
      `alter table if exists "messaging_conversation" drop column if exists "default_sender_platform_id";`
    );
  }
}
