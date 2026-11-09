import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * #2532 — the registered address a GST tax invoice prints as the seller's.
 * Idempotent (`add column if not exists`), like this module's other migrations.
 */
export class Migration20261109140000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "platform_tax_identity" add column if not exists "registered_address" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "platform_tax_identity" drop column if exists "registered_address";`);
  }

}
