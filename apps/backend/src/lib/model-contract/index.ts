/**
 * Read a DML model's real field list, so a test can be AWARE of model changes
 * instead of restating them.
 *
 * 🔑 The problem this exists to end. Three of the five specs failing on `main`
 * on 2026-09-12 were one species: a test (or a shaper) hand-listed the fields a
 * model produces, the model grew a field, and the hand-list silently went
 * stale. `pickDesignBrief` restated the design brief's 8 columns; the spec
 * restated 6 of them; `DESIGN_BRIEF_FIELDS` restated them a third time, and a
 * byte-identical fourth copy lives under the admin route. Nothing tied any of
 * them to the `design` model, so #1113 S2 adding `aesthetic_keywords` and
 * `milestones` broke a test for a defect that did not exist.
 *
 * A Medusa DML model exposes `{ name, schema }` at runtime — `schema` is keyed
 * by column name — so none of that restating is necessary. No database, no
 * migration snapshot (only 32 of 86 modules have one committed), no parsing of
 * TypeScript: just import the model and ask it.
 */

/** The shape `model.define()` returns. Structural, so it needs no import. */
export type DmlModelLike = {
  name?: string
  schema?: Record<string, unknown>
}

/** Every column a model declares, sorted, so comparisons are order-free. */
export const modelFields = (model: DmlModelLike | null | undefined): string[] =>
  Object.keys(model?.schema ?? {}).sort()

/** The table name the model declares (`model.define("design", …)` → "design"). */
export const modelName = (model: DmlModelLike | null | undefined): string | null =>
  typeof model?.name === "string" && model.name ? model.name : null

/**
 * The difference between what a projection claims and what the model has.
 *
 * `missing` are model columns the projection does not mention — usually the
 * drift, and usually the bug. `unknown` are names the projection mentions that
 * the model does not have: a typo, or a rename that landed on one side only.
 * Both directions matter, which is why this returns them separately rather
 * than a boolean.
 */
export const compareToModel = (
  model: DmlModelLike | null | undefined,
  claimed: readonly string[]
): { missing: string[]; unknown: string[] } => {
  const actual = new Set(modelFields(model))
  const stated = new Set(claimed)
  return {
    missing: [...actual].filter((f) => !stated.has(f)).sort(),
    unknown: [...stated].filter((f) => !actual.has(f)).sort(),
  }
}
