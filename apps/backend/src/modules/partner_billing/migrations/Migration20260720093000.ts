import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * #336 follow-up — retail partner fee split (2% payment gateway + 15% commission).
 *
 * Adds a `fee_type` discriminator and the itemised retail_split breakdown
 * columns to `partner_fee`. Legacy work-order rows stay `fee_type='commission'`
 * with the breakdown columns null. bigNumber columns carry their `raw_` jsonb
 * sidecar (Medusa money convention) — nullable here since only retail_split
 * rows populate them.
 */
export class Migration20260720093000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "partner_fee" add column if not exists "fee_type" text check ("fee_type" in ('commission', 'retail_split')) not null default 'commission';`);
    this.addSql(`alter table if exists "partner_fee" add column if not exists "payment_gateway_bps" integer null;`);
    this.addSql(`alter table if exists "partner_fee" add column if not exists "payment_gateway_amount" numeric null;`);
    this.addSql(`alter table if exists "partner_fee" add column if not exists "raw_payment_gateway_amount" jsonb null;`);
    this.addSql(`alter table if exists "partner_fee" add column if not exists "commission_bps" integer null;`);
    this.addSql(`alter table if exists "partner_fee" add column if not exists "commission_amount" numeric null;`);
    this.addSql(`alter table if exists "partner_fee" add column if not exists "raw_commission_amount" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "partner_fee" drop column if exists "fee_type";`);
    this.addSql(`alter table if exists "partner_fee" drop column if exists "payment_gateway_bps";`);
    this.addSql(`alter table if exists "partner_fee" drop column if exists "payment_gateway_amount";`);
    this.addSql(`alter table if exists "partner_fee" drop column if exists "raw_payment_gateway_amount";`);
    this.addSql(`alter table if exists "partner_fee" drop column if exists "commission_bps";`);
    this.addSql(`alter table if exists "partner_fee" drop column if exists "commission_amount";`);
    this.addSql(`alter table if exists "partner_fee" drop column if exists "raw_commission_amount";`);
  }

}
