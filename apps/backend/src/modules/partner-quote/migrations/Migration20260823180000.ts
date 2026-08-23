import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * #1486 — a quote line remembers it was picked as a design.
 *
 * Nullable with no backfill. Every existing line WAS picked as a variant, and
 * inferring a design from the variant's links after the fact would assert a
 * choice the partner never made — a variant can be linked to a design it was
 * merely used in.
 */
export class Migration20260823180000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "partner_quote_line" add column if not exists "design_id" text null;`
    )
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "partner_quote_line" drop column if exists "design_id";`)
  }

}
