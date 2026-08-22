import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * #1439 S8 (tail) — freeze the tax figure at mint.
 *
 * S8 computed tax but only ever at READ time, so a quote's tax moved whenever a
 * rate or a region setting changed while the subtotal and freight frozen beside
 * it stayed put. A buyer opening a quote a week later could be shown a landed
 * total whose parts no longer added up to what was sent. Freezing the tax is
 * the same argument that froze the subtotal.
 *
 * `frozenMoney` has read `quoted_tax_total` / `quoted_tax_inclusive` since S8
 * landed — the columns simply never existed, so it returned null every time.
 * Written, tested, and fed by nothing, exactly like `buildProvenance` (#1448).
 *
 * ## Why four columns and not one
 *
 * A frozen `0` on its own cannot say whether it means "zero-rated export, no
 * tax due" or "we could not determine it" — and that distinction is the entire
 * reason `QuoteTax.status` exists rather than a bare number. `quoted_tax_reason`
 * preserves the sentence the buyer was shown; on an export that sentence is the
 * only place they were told import duty is theirs to pay, which makes it
 * evidence rather than decoration.
 *
 * ⚠️ A DML `bigNumber` is TWO columns: the numeric one and a `raw_*` jsonb
 * companion carrying the precision. Adding only the numeric one lets the model,
 * tsc and every unit test pass, then fails the INSERT at runtime with
 * `column "raw_quoted_tax_total" does not exist` — how the S7 pair (#1446) was
 * caught, on the first real mint.
 *
 * Every column is nullable and nothing is backfilled. Quotes minted before S8
 * genuinely have no tax figure; writing a 0 onto them would retroactively
 * assert they were tax-free.
 */
export class Migration20260822164500 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "partner_quote" add column if not exists "quoted_tax_total" numeric null;`);
    this.addSql(`alter table if exists "partner_quote" add column if not exists "raw_quoted_tax_total" jsonb null;`);
    this.addSql(`alter table if exists "partner_quote" add column if not exists "quoted_tax_inclusive" boolean null;`);
    this.addSql(`alter table if exists "partner_quote" add column if not exists "quoted_tax_status" text null;`);
    this.addSql(`alter table if exists "partner_quote" add column if not exists "quoted_tax_reason" text null;`);

    // Mirrors the QuoteTax union. A status outside it means something wrote a
    // value the renderer has no branch for, which would surface as a silently
    // missing tax block — the failure this slice exists to prevent.
    this.addSql(`alter table if exists "partner_quote" drop constraint if exists "partner_quote_quoted_tax_status_check";`);
    this.addSql(`alter table if exists "partner_quote" add constraint "partner_quote_quoted_tax_status_check" check ("quoted_tax_status" is null or "quoted_tax_status" in ('calculated', 'zero_rated_export', 'not_applicable', 'unknown'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "partner_quote" drop constraint if exists "partner_quote_quoted_tax_status_check";`);
    this.addSql(`alter table if exists "partner_quote" drop column if exists "quoted_tax_total";`);
    this.addSql(`alter table if exists "partner_quote" drop column if exists "raw_quoted_tax_total";`);
    this.addSql(`alter table if exists "partner_quote" drop column if exists "quoted_tax_inclusive";`);
    this.addSql(`alter table if exists "partner_quote" drop column if exists "quoted_tax_status";`);
    this.addSql(`alter table if exists "partner_quote" drop column if exists "quoted_tax_reason";`);
  }

}
