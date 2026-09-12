import Design from "../../../modules/designs/models/design"
import { compareToModel, modelFields } from "../index"
import {
  DESIGN_BRIEF_FIELDS as PARTNER_BRIEF_FIELDS,
  pickDesignBrief as pickPartnerBrief,
} from "../../../api/partners/designs/[designId]/brief/validators"
import { DESIGN_BRIEF_FIELDS as ADMIN_BRIEF_FIELDS } from "../../../api/admin/designs/[id]/brief/validators"
import { DESIGN_BRIEF_GRAPH_FIELDS } from "../../../workflows/designs/moodboard/techpack-input-from-design"

/**
 * The design brief's field list exists in FOUR places:
 *
 *   1. `pickDesignBrief`'s return literal          (partner route)
 *   2. `DESIGN_BRIEF_FIELDS`                       (partner route)
 *   3. `DESIGN_BRIEF_FIELDS`                       (admin route — a byte-identical copy)
 *   4. `DESIGN_BRIEF_GRAPH_FIELDS`                 (moodboard techpack input)
 *
 * ...and the columns themselves live in a fifth: the `design` model. Nothing
 * tied any of them together, so when #1113 S2 added `aesthetic_keywords` and
 * `milestones`, the partner spec failed for a defect that did not exist and sat
 * red on `main` until someone happened to edit that file.
 *
 * Deleting three of the four copies is the real fix and is a bigger change than
 * one test should make. Until then this pins them to each other AND to the
 * model, so a divergence fails HERE, immediately, naming the field — instead of
 * surfacing months later as a mystery in an unrelated suite.
 */

describe("design brief field contract", () => {
  it("admin and partner declare the same brief", () => {
    // 🔴 Two hand-maintained copies of one contract. Whichever is edited alone
    // makes the two storefronts disagree about what a brief IS.
    expect([...ADMIN_BRIEF_FIELDS].sort()).toEqual([...PARTNER_BRIEF_FIELDS].sort())
  })

  it("every declared brief field is a real column on the design model", () => {
    // Catches the direction a hand-list cannot: a typo or a rename that landed
    // on the model but not here reads as a field that silently never populates.
    const { unknown } = compareToModel(Design as any, [...PARTNER_BRIEF_FIELDS])
    expect(unknown).toEqual([])
  })

  it("the moodboard graph selector stays a superset of the brief", () => {
    // It intentionally adds `target_completion_date`; what it must never do is
    // DROP a brief column, which would silently blank that field on the techpack.
    const missing = [...PARTNER_BRIEF_FIELDS].filter(
      (f) => !(DESIGN_BRIEF_GRAPH_FIELDS as readonly string[]).includes(f)
    )
    expect(missing).toEqual([])
  })

  it("the shaper returns exactly the declared fields", () => {
    const shaped = pickPartnerBrief({ id: "d" })!
    expect(Object.keys(shaped).sort()).toEqual([...PARTNER_BRIEF_FIELDS].sort())
  })

  it("the design model actually has the brief columns (guard is not vacuous)", () => {
    // 🔴 If the model import ever yielded an empty schema, every assertion above
    // would pass by describing nothing.
    const fields = modelFields(Design as any)
    expect(fields.length).toBeGreaterThan(10)
    expect(fields).toEqual(expect.arrayContaining([...PARTNER_BRIEF_FIELDS]))
  })
})
