import { Migration } from "@mikro-orm/migrations";

/**
 * #1979 — let a production run SAY what its cost is denominated in.
 *
 * The run carried `partner_cost_estimate` as a bare number and `cost_type`
 * saying whether it was per-unit or total, but nothing said which CURRENCY.
 * `RunCostSummary` had no currency field either, so approval — which turns a
 * run's cost into a listed price — had to guess, and guessed the store default.
 * On a EUR store that listed a cost of ₹2,634.75 as €2,634.75, about 110×.
 *
 * Nullable with no default, so every existing run reads as UNSTATED, which is
 * exactly what they are. Approval then falls back to the design's
 * `cost_currency` and finally to INR, so behaviour for old runs is unchanged.
 *
 * ⚠️ Deliberately NOT backfilled to 'inr' here. A migration that stamps a
 * currency onto historical rows is asserting something nobody verified; the
 * `backfill-design-cost-currency` maintenance job exists so that kind of claim
 * is made by an operator with a dry-run in front of them, not by a schema change.
 */
export class Migration20260911070000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`
      alter table if exists "production_runs"
        add column if not exists "cost_currency" text null;
    `);
  }

  /**
   * Reversible: without the column every run reads as unstated again and
   * approval falls back exactly as it did before. It DOES discard whatever
   * currencies were recorded — acceptable because the fallback chain gives the
   * same answer for the INR case, which is all of prod today.
   */
  override async down(): Promise<void> {
    this.addSql(`
      alter table if exists "production_runs"
        drop column if exists "cost_currency";
    `);
  }

}
