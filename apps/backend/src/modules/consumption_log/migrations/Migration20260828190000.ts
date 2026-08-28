import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Close the empty-string hole in the design-or-product CHECK.
 *
 * `Migration20260828164500` added
 * `check ("design_id" is not null or "product_id" is not null)` to stop a
 * consumption log being anchored to nothing. It does not hold: `''` is not
 * null, so a row with `design_id = ''` satisfies the constraint while naming
 * nothing at all.
 *
 * 🔴 Not hypothetical. Run `prod_run_01KZ3DA8TV6SR2A90FR1Q1WGWW` carries two
 * COMMITTED logs written 2026-08-27 with `design_id = ''` — 20 @ 250 and
 * 30 @ 9.5 — on a run whose own `design_id` is null. Something upstream
 * coerced a missing id to an empty string instead of null, and every reader
 * that asks `!l.design_id` (the reconciliation fold, line 213) already treats
 * them as design-less. The schema was the only layer still calling them
 * anchored.
 *
 * The application guard `anchorRefusalMessage` has always refused `''`; this
 * brings the constraint up to the same rule so the two cannot disagree.
 *
 * ⚠️ Existing `''` rows are NOT rewritten here. They are committed records of
 * material that was really consumed, and a migration that guessed their anchor
 * — or deleted them to satisfy a constraint — would destroy production data.
 * They are normalised by the `repair-consumption-log` ops job instead, where
 * the change is a dry-run-able, reviewable decision rather than a silent
 * side effect of a deploy. Which is why this is written as NOT VALID.
 */
export class Migration20260828190000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "consumption_log" drop constraint if exists "consumption_log_design_or_product_check";`);

    /**
     * NOT VALID: enforced on every INSERT and UPDATE from now on, but existing
     * rows are not re-checked. Without it this migration fails on any database
     * already holding an empty-string row — including prod — and a deploy that
     * cannot run its migration strands every later one behind it.
     */
    this.addSql(`alter table if exists "consumption_log" add constraint "consumption_log_design_or_product_check" check ((("design_id" is not null and "design_id" <> '') or ("product_id" is not null and "product_id" <> ''))) not valid;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "consumption_log" drop constraint if exists "consumption_log_design_or_product_check";`);
    this.addSql(`alter table if exists "consumption_log" add constraint "consumption_log_design_or_product_check" check ("design_id" is not null or "product_id" is not null);`);
  }

}
