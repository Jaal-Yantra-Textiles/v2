import { model } from "@medusajs/framework/utils"

/**
 * Platform cost config (#1939) — the economic constants that decide what a
 * design costs and what a buyer pays, in one readable place.
 *
 * ## Why this exists
 *
 * These numbers were scattered across four files as `export const`s, so the
 * only way to see the platform's pricing policy was to grep for it — and the
 * only way to change it was a deploy. Worse, nobody could see them TOGETHER:
 * there are two different markups in this codebase (20% on the quote path,
 * ×1.40 on the approval path) and that is invisible until they sit in one row.
 *
 * ## Why typed columns and not key/value
 *
 * A `key`/`value` table would be more flexible and would be a mistake. These
 * numbers decide payouts and retail prices, and this codebase has already paid
 * for untyped contracts twice — a `metadata` blob that decided partner payouts,
 * and typed fields at the door with an untyped contract behind them. A column
 * per number means a migration to add one, a type error when a reader guesses,
 * and a grep that actually finds the readers.
 *
 * ## Why effective-dated and not a mutable singleton
 *
 * ONE ROW PER POLICY PERIOD, not a row someone edits in place — the same shape
 * `platform_export_lut` uses for LUTs. A design quoted in March at 20% markup
 * must still be explicable in June after the markup moves to 25%. Changing a
 * price is an INSERT with a new `effective_from`; the old row stays readable,
 * which is the only way to answer "what did we charge under, and why?" later.
 *
 * 🔴 Every economic column is NULLABLE and null means NOT CONFIGURED — it does
 * NOT mean zero. A 0 platform fee is a real, deliberate policy ("we take no
 * commission"); a null is the absence of a decision. Readers must ask
 * `!= null`, never truthiness, because `0` is falsy and `Number(null)` is `0`.
 * This codebase has shipped that exact bug: an estimator reported "I found
 * nothing" as `total_estimated: 0` and it reached storefront checkout.
 *
 * ## What deliberately is NOT here
 *
 * The photoshoot budget. It lives in the Photo Shoot task templates and is
 * summed by `photoshootBudget()` — operator-editable in Settings → Task
 * Templates, which is the right home for a number the ops team tunes per shoot.
 * Duplicating it here would create two sources of truth for the same money.
 * Marketing, tech and shipping overheads are also absent: #1939 has not settled
 * their UNIT yet, and a column nobody writes is a field readers will guess at.
 */
const PlatformCostConfig = model.define("platform_cost_config", {
  id: model.id().primaryKey(),

  /**
   * The instant this policy takes effect. The row in force at a given moment is
   * the active one with the LATEST `effective_from` at or before it — so a
   * future-dated row can be staged without taking effect.
   */
  effective_from: model.dateTime(),

  /**
   * Why this policy changed, for the person reading it back in six months.
   * Free text, but write the decision, not the number — the number is a column.
   */
  notes: model.text().nullable(),

  /**
   * Superseded rows are deactivated rather than deleted: a policy a past quote
   * was priced under must stay readable. Inactive rows are skipped entirely.
   */
  is_active: model.boolean().default(true),

  /**
   * JYT's commission on partner production work, as a percentage of material
   * cost. Was `DEFAULT_PLATFORM_FEE_PERCENT = 10`.
   * 0 is meaningful here: "we take no commission". null is "undecided".
   */
  platform_fee_percent: model.float().nullable(),

  /**
   * Production overhead as a percentage of material cost. Was the un-exported
   * `DEFAULT_PRODUCTION_PERCENT = 30` — un-exported meant no test could reach it.
   */
  production_overhead_percent: model.float().nullable(),

  /**
   * Fallback per-unit material cost when a BOM material has NO resolved price
   * (no order history, no unit_cost, no consumption log). Was
   * `DEFAULT_MATERIAL_COST = 600`.
   *
   * 🔴 A fallback, applied only when a caller opts in. It is a guess standing in
   * for a fact, and a design priced on it is less certain than one priced on
   * real purchases — which is why the estimator reports `confidence` alongside.
   *
   * `float`, not `bigNumber`, deliberately: this replaces a plain
   * `const DEFAULT_MATERIAL_COST = 600` and feeds an estimator that does
   * ordinary JS arithmetic with a `round2` helper throughout. `bigNumber` would
   * add a companion `raw_default_material_cost` jsonb column and MikroORM
   * hydration machinery to a configuration default that never participates in a
   * transaction — precision this number does not have to begin with, since it
   * is a stand-in for a price nobody looked up.
   */
  default_material_cost: model.float().nullable(),

  /** Currency of `default_material_cost` (e.g. "INR"). A cost with no currency cannot be added up. */
  default_material_cost_currency: model.text().nullable(),

  /**
   * Markup on a custom/commissioned design's quoted price, as a PERCENTAGE.
   * Was `DEFAULT_CUSTOM_DESIGN_MARKUP_PERCENT = 20`. The founder's 2026-09-09
   * decision extends this from quotes to the retail path too.
   */
  custom_design_markup_percent: model.float().nullable(),

  /**
   * Markup applied when a production run's approved output is listed, as a
   * MULTIPLIER on cost. Was `APPROVAL_MARKUP = 1.4`.
   *
   * ⚠️ A multiplier, not a percentage, and deliberately a different column from
   * `custom_design_markup_percent` — they are different shapes AND different
   * numbers (×1.40 vs 20%). Storing both as "markup" would invite a reader to
   * use one where the other belongs. Note ×1.40 is a markup ON COST: the margin
   * is 28.6% (0.4/1.4), not 40%.
   */
  approval_markup_multiplier: model.float().nullable(),
})

export default PlatformCostConfig
