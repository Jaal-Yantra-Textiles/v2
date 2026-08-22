import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * #1447 — a DDP undertaking is THREE charges, not one.
 *
 * `quoted_duty_total` alone funded the smaller half. DHL Express's landed-cost
 * planner, on a 70,000 INR consignment to the Netherlands:
 *
 *   customs duty      8% × (goods + freight)          =  6,143.36
 *   import VAT       21% × (goods + freight + duty)   = 17,416.43
 *   duty-tax-paid fee (carrier's advance charge)      =  1,981.57
 *
 * The VAT is 2.8× the duty, and the base CASCADES — VAT is assessed on a value
 * that already includes the duty. A partner told to "enter the duty" funds
 * 6,143 of a 25,541 promise, and nobody finds out, because the shortfall lands
 * on our margin rather than on the buyer.
 *
 * The rates are frozen beside the amounts so the figure can be re-derived
 * against a carrier invoice months later instead of merely believed. Null rates
 * mean a flat amount was entered — a specific duty is charged per kilo, and no
 * percentage expresses it.
 *
 * ⚠️ Two of these are DML `bigNumber`s, so four columns: each numeric one needs
 * its `raw_*` jsonb companion or the INSERT fails at runtime while the model,
 * tsc and every unit test pass. The rates are plain numbers — they are not
 * money and carry no precision context.
 */
export class Migration20260822213000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "partner_quote" add column if not exists "quoted_import_tax_total" numeric null;`);
    this.addSql(`alter table if exists "partner_quote" add column if not exists "raw_quoted_import_tax_total" jsonb null;`);
    this.addSql(`alter table if exists "partner_quote" add column if not exists "quoted_ddp_fee_total" numeric null;`);
    this.addSql(`alter table if exists "partner_quote" add column if not exists "raw_quoted_ddp_fee_total" jsonb null;`);
    this.addSql(`alter table if exists "partner_quote" add column if not exists "quoted_duty_rate" real null;`);
    this.addSql(`alter table if exists "partner_quote" add column if not exists "quoted_import_tax_rate" real null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "partner_quote" drop column if exists "quoted_import_tax_total";`);
    this.addSql(`alter table if exists "partner_quote" drop column if exists "raw_quoted_import_tax_total";`);
    this.addSql(`alter table if exists "partner_quote" drop column if exists "quoted_ddp_fee_total";`);
    this.addSql(`alter table if exists "partner_quote" drop column if exists "raw_quoted_ddp_fee_total";`);
    this.addSql(`alter table if exists "partner_quote" drop column if exists "quoted_duty_rate";`);
    this.addSql(`alter table if exists "partner_quote" drop column if exists "quoted_import_tax_rate";`);
  }

}
