import { model } from "@medusajs/framework/utils"
import Design from "./design"

/**
 * One moodboard, owned by ONE party (#2017).
 *
 * ## What this replaces
 *
 * `design.moodboard` — a single `jsonb` column on the design. An admin and a
 * partner editing "their" boards were editing the same blob, and the partner
 * save replaced it wholesale:
 *
 *     const { moodboard } = req.validatedBody
 *     await updateDesignWorkflow(...).run({ input: { id: designId, moodboard } })
 *
 * Last write wins, silently, with a 200 — the same shape as the variant-price
 * save that hard-deleted 11 rows and the service-zone update that replaces
 * `geo_zones`. Nobody is told; the other party's work is simply gone the next
 * time they open it.
 *
 * ## The column is NOT dropped here
 *
 * `design.moodboard` stays, readable, as the fallback — a row that has not
 * been migrated yet must still render. Checked before relying on that: the
 * column is `jsonb`, **nullable, with no default** (`.snapshot-design.json`),
 * so an absent board really does read as absent. Where the column is NOT NULL
 * with a default, a fallback like this is unreachable and the code only looks
 * like it honours legacy rows.
 *
 * ## Ownership
 *
 * `owner_type` is the discriminator and `partner_id` is null for the core
 * board. A design has at most one `core` row and any number of partner rows,
 * one per partner — enforced by the two partial unique indexes below rather
 * than by convention, because "one board per owner" is the entire point of the
 * entity and a second core row would restore the ambiguity it exists to remove.
 */
const DesignMoodboard = model
  .define("design_moodboard", {
    id: model.id().primaryKey(),
    /**
     * "core" (ours) or "partner" (theirs). Not an enum in the DML on purpose:
     * an enum change is a migration, and a third owner kind (a customer board,
     * a supplier board) is foreseeable. The routes validate the value.
     */
    owner_type: model.text(),
    /** Null for the core board; the owning partner for a partner board. */
    partner_id: model.text().nullable(),
    title: model.text().nullable(),
    /** The Excalidraw scene — the thing `design.moodboard` used to hold. */
    scene: model.json().nullable(),
    /**
     * Not decoration: it is what makes a mobile preview and a non-dead entry
     * card possible. Until a board has one, the card can count frames and
     * nothing else.
     */
    thumbnail_url: model.text().nullable(),
    metadata: model.json().nullable(),

    design: model.belongsTo(() => Design, {
      mappedBy: "moodboards",
    }),
  })
  .indexes([
    { on: ["design_id"] },
    { on: ["partner_id"] },
    /**
     * At most ONE core board per design. Partial, so it constrains only the
     * core rows and leaves partner rows alone.
     */
    {
      on: ["design_id"],
      unique: true,
      where: "owner_type = 'core' AND deleted_at IS NULL",
    },
    /**
     * At most one board per partner per design. `partner_id IS NOT NULL`
     * matters: without it Postgres treats every NULL as distinct, so the core
     * rows would slip past this index and it would silently constrain nothing
     * that the index above does not already cover.
     */
    {
      on: ["design_id", "partner_id"],
      unique: true,
      where: "partner_id IS NOT NULL AND deleted_at IS NULL",
    },
  ])

export default DesignMoodboard
