import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260414010000 extends Migration {

  override async up(): Promise<void> {
    // Add 'queued' to the messaging_message status enum
    this.addSql(`ALTER TYPE IF EXISTS "messaging_message_status_enum" ADD VALUE IF NOT EXISTS 'queued';`);
  }

  override async down(): Promise<void> {
    // Enum values cannot be removed in PostgreSQL without recreating the type
    // This is a no-op for down migration
  }
}
