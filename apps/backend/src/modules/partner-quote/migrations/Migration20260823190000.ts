import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * The buyer's own tax registration on the quote document.
 *
 * Nullable, no backfill, and deliberately NOT derived from the customer record:
 * a B2B buyer's VAT number is something they state for this deal, and inferring
 * one from an address or an earlier order would put a number on a commercial
 * document that nobody typed.
 */
export class Migration20260823190000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "partner_quote" add column if not exists "buyer_tax_id" text null;`
    )
    this.addSql(
      `alter table if exists "partner_quote" add column if not exists "buyer_tax_id_type" text null;`
    )
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "partner_quote" drop column if exists "buyer_tax_id_type";`)
    this.addSql(`alter table if exists "partner_quote" drop column if exists "buyer_tax_id";`)
  }

}
