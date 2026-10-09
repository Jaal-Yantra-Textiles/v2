import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * The quote remembers what makes its balance due, so acceptance can copy it
 * onto the payment schedule. Nullable with no backfill: null means `dispatch`,
 * which is what every earlier quote was agreed on.
 */
export class Migration20261009170100 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "partner_quote" add column if not exists "balance_trigger" text check ("balance_trigger" in ('dispatch', 'sample_approved', 'manual')) null;`
    )
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "partner_quote" drop column if exists "balance_trigger";`)
  }
}
