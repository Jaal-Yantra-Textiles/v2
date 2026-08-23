import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * #1439 S7 — record HOW a quoted line's price was reached.
 *
 * `quoted_unit_amount` was always the final number, but until now it was
 * always the live catalog price: there was no discount concept anywhere in the
 * quote path, so a partner could not quote a trade price at all.
 *
 * These four columns hold the partner's actual input beside the result. The
 * input amount is what they TYPED, in the store's default currency — the one
 * they negotiate in — and the rate is the one applied at mint. All three are
 * needed together: a quoted number that cannot be reproduced once FX has moved
 * is not evidence, and FX is precisely the input that will have moved by the
 * time a buyer disputes a price.
 *
 * Every column is nullable and nothing is backfilled. A line quoted at its
 * catalog price has no override, and writing a 0 or a rate of 1 onto historic
 * rows would invent a decision nobody made.
 */
export class Migration20260822093000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "partner_quote_line" add column if not exists "override_kind" text null;`);
    // ⚠️ A DML `bigNumber` is TWO columns: the numeric one and a `raw_*` jsonb
    // companion that carries the precision. Adding only the numeric one lets
    // tsc, the model and every unit test pass, and then fails the INSERT at
    // runtime with `column "raw_override_input_amount" does not exist` — which
    // is exactly how this was caught, on the first real mint.
    this.addSql(`alter table if exists "partner_quote_line" add column if not exists "override_input_amount" numeric null;`);
    this.addSql(`alter table if exists "partner_quote_line" add column if not exists "raw_override_input_amount" jsonb null;`);
    this.addSql(`alter table if exists "partner_quote_line" add column if not exists "override_input_currency_code" text null;`);
    this.addSql(`alter table if exists "partner_quote_line" add column if not exists "override_fx_rate" real null;`);

    this.addSql(`alter table if exists "partner_quote_line" drop constraint if exists "partner_quote_line_override_kind_check";`);
    this.addSql(`alter table if exists "partner_quote_line" add constraint "partner_quote_line_override_kind_check" check ("override_kind" is null or "override_kind" in ('discount_percent', 'override_unit_amount'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "partner_quote_line" drop constraint if exists "partner_quote_line_override_kind_check";`);
    this.addSql(`alter table if exists "partner_quote_line" drop column if exists "override_kind";`);
    this.addSql(`alter table if exists "partner_quote_line" drop column if exists "override_input_amount";`);
    this.addSql(`alter table if exists "partner_quote_line" drop column if exists "raw_override_input_amount";`);
    this.addSql(`alter table if exists "partner_quote_line" drop column if exists "override_input_currency_code";`);
    this.addSql(`alter table if exists "partner_quote_line" drop column if exists "override_fx_rate";`);
  }

}
