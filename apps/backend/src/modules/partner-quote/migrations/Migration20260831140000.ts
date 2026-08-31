import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Let a quote line record that a HUMAN supplied its weight.
 *
 * ## What was broken
 *
 * `quoted_weight_source` is a check constraint over `('variant','product')`,
 * and `resolveUnitWeight` has always answered `"manual"` for an operator-typed
 * `unit_weight_grams`. `mint-quote` writes that value straight onto the line,
 * so every quote minted with a hand-typed weight died at the INSERT with
 * `CheckConstraintViolationException` and returned a bare 500 with an HTML
 * error page — no message a partner or an operator could act on.
 *
 * The input exists precisely for the baskets the catalogue cannot weigh: 140
 * of 183 variants carry no weight at either level, and a made-to-order design
 * quoted before its garment was ever weighed has none by definition. So the
 * one path that makes those quotable is the one that could not be written.
 *
 * 🔑 Widening, never narrowing: every existing row is `variant`, `product` or
 * null and stays valid, so this cannot fail on data. The constraint is dropped
 * and recreated rather than altered because Postgres has no `alter constraint`
 * for a check body.
 *
 * ⚠️ `drop constraint if exists` + a uniquely-named recreate, so a re-run is a
 * no-op (#1208) — this module's migrations are replayed on every deploy.
 */
export class Migration20260831140000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "partner_quote_line" drop constraint if exists "partner_quote_line_quoted_weight_source_check";`);
    this.addSql(`alter table if exists "partner_quote_line" add constraint "partner_quote_line_quoted_weight_source_check" check ("quoted_weight_source" in ('variant', 'product', 'manual'));`);
  }

  override async down(): Promise<void> {
    // 🔴 Narrowing again would fail on any row minted with a typed weight in
    // the meantime, so those are neutralised first. The weight itself
    // (`quoted_unit_weight_grams`) is kept — the figure the buyer was quoted
    // against must survive a rollback; only its provenance label cannot be
    // expressed by the older constraint.
    this.addSql(`update "partner_quote_line" set "quoted_weight_source" = null where "quoted_weight_source" = 'manual';`);
    this.addSql(`alter table if exists "partner_quote_line" drop constraint if exists "partner_quote_line_quoted_weight_source_check";`);
    this.addSql(`alter table if exists "partner_quote_line" add constraint "partner_quote_line_quoted_weight_source_check" check ("quoted_weight_source" in ('variant', 'product'));`);
  }

}
