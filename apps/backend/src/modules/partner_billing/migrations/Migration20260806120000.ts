import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Platform shipping recovery on `partner_fee`.
 *
 * When a partner ships on OUR carrier account instead of their own, what that
 * label actually cost is a second deduction from their payout, alongside the
 * commission. Until now it was recorded nowhere — the only trace was
 * `fulfillment.data.provider_refs.courier_rate`, which is per-fulfillment,
 * unqueryable JSONB and overwritten on re-label.
 *
 * All three columns are nullable: null means the partner did not use our
 * shipping (own AWB / own account / no label yet) and nothing is deducted.
 * `shipping_currency_code` is separate from the row's `currency_code` on
 * purpose — carriers quote in their own currency, not the order's.
 *
 * `shipping_amount` is a bigNumber and therefore carries its `raw_` jsonb
 * sidecar (Medusa money convention), same as the retail_split columns.
 *
 * This module has no MikroORM snapshot, so — like Migration20260720093000
 * before it — the migration is hand-rolled additively rather than generated.
 */
export class Migration20260806120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "partner_fee" add column if not exists "shipping_amount" numeric null;`);
    this.addSql(`alter table if exists "partner_fee" add column if not exists "raw_shipping_amount" jsonb null;`);
    this.addSql(`alter table if exists "partner_fee" add column if not exists "shipping_currency_code" text null;`);
    this.addSql(`alter table if exists "partner_fee" add column if not exists "shipping_carrier" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "partner_fee" drop column if exists "shipping_amount";`);
    this.addSql(`alter table if exists "partner_fee" drop column if exists "raw_shipping_amount";`);
    this.addSql(`alter table if exists "partner_fee" drop column if exists "shipping_currency_code";`);
    this.addSql(`alter table if exists "partner_fee" drop column if exists "shipping_carrier";`);
  }

}
