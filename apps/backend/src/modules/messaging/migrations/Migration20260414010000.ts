import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260414010000 extends Migration {

  override async up(): Promise<void> {
    // Medusa DML enum is stored as text + check constraint, not a PG enum type
    // Drop the old constraint and add a new one that includes 'queued'
    this.addSql(`ALTER TABLE "messaging_message" DROP CONSTRAINT IF EXISTS "messaging_message_status_check";`);
    this.addSql(`ALTER TABLE "messaging_message" ADD CONSTRAINT "messaging_message_status_check" CHECK (status = ANY (ARRAY['pending','sent','delivered','read','failed','queued']));`);
  }

  override async down(): Promise<void> {
    this.addSql(`ALTER TABLE "messaging_message" DROP CONSTRAINT IF EXISTS "messaging_message_status_check";`);
    this.addSql(`ALTER TABLE "messaging_message" ADD CONSTRAINT "messaging_message_status_check" CHECK (status = ANY (ARRAY['pending','sent','delivered','read','failed']));`);
  }
}
