import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Priced spec choices (#2456): a per-piece surcharge and a one-time setup fee
 * on an option value, and the variants an option is offered on.
 *
 * All nullable, so every existing spec keeps reading as free choices on the
 * whole product. Idempotent, safe to re-run.
 */
export class Migration20261028120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "product_spec_option_value" add column if not exists "price_per_piece" numeric null, add column if not exists "raw_price_per_piece" jsonb null, add column if not exists "setup_fee" numeric null, add column if not exists "raw_setup_fee" jsonb null, add column if not exists "price_currency_code" text null;`);
    this.addSql(`alter table if exists "product_spec_option" add column if not exists "variant_ids" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "product_spec_option_value" drop column if exists "price_per_piece", drop column if exists "raw_price_per_piece", drop column if exists "setup_fee", drop column if exists "raw_setup_fee", drop column if exists "price_currency_code";`);
    this.addSql(`alter table if exists "product_spec_option" drop column if exists "variant_ids";`);
  }

}
