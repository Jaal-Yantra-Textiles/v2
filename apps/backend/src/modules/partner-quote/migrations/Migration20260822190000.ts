import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * #1447 — the manual customs duty figure behind the DDP undertaking.
 *
 * `duties_prepaid` (Migration20260822164500) told the buyer "import duty is
 * included and paid by us" and added **nothing** to the price: `composeQuoteMoney`
 * was `subtotal + freight (+ tax)` and the word "duty" appeared only in prose.
 * The promise was kept out of margin, by an amount nobody computed.
 *
 * Deriving duty is genuinely blocked — 138 HS-code gaps across 65 products, EU
 * 2–14% with possible GSP relief, and Shiprocket returns `tariff: 0` / `tariff_data: []`
 * pending CSB-5 KYC — so the partner enters the number and it freezes with the
 * rest of what was promised.
 *
 * ## Why a basis column and not just an amount
 *
 * A frozen `0` cannot say whether it means "AI-ECTA, Indian textiles enter
 * Australia duty-free" or "someone ticked DDP and left the box empty". That is
 * the same ambiguity that made `quoted_tax_status`/`quoted_tax_reason` necessary
 * beside `quoted_tax_total`, and it matters more here: this number is a
 * liability we take on, and the person who meets the customs invoice months
 * later is not the person who typed it.
 *
 * ⚠️ A DML `bigNumber` is TWO columns — the numeric one and its `raw_*` jsonb
 * companion. Adding only the numeric one passes the model, tsc and every unit
 * test, then fails the INSERT at runtime with `column "raw_quoted_duty_total"
 * does not exist` (how the S7 pair was caught, on the first real mint).
 *
 * Nullable, nothing backfilled: a quote minted before this genuinely has no
 * duty figure, and writing 0 would retroactively assert it was duty-free.
 */
export class Migration20260822190000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "partner_quote" add column if not exists "quoted_duty_total" numeric null;`);
    this.addSql(`alter table if exists "partner_quote" add column if not exists "raw_quoted_duty_total" jsonb null;`);
    this.addSql(`alter table if exists "partner_quote" add column if not exists "quoted_duty_basis" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "partner_quote" drop column if exists "quoted_duty_total";`);
    this.addSql(`alter table if exists "partner_quote" drop column if exists "raw_quoted_duty_total";`);
    this.addSql(`alter table if exists "partner_quote" drop column if exists "quoted_duty_basis";`);
  }

}
