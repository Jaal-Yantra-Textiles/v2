import { defineLink } from "@medusajs/framework/utils"
import ProductionRunsModule from "../modules/production_runs"
import InventoryModule from "@medusajs/medusa/inventory"

/**
 * The per-ASSIGNMENT material allocation: which of a design's inventory items
 * THIS run was actually sent out with, and how much of each.
 *
 * Before this link, a run snapshotted the design's ENTIRE bill of materials
 * (`fetchDesignInventorySnapshotStep` filtered on `design_id` alone) and the
 * partner's consumption picker offered every item the design had ever been
 * linked to. A design with five inventory items handed to two partners asked
 * both of them about all five — there was no way to say "this partner is only
 * getting the silk".
 *
 * Authoritative on purpose. `run.snapshot.inventory_links` is narrowed to match
 * this allocation, but the snapshot is a json blob that a metadata-shaped write
 * can replace wholesale, and consumption is REJECTED against items outside the
 * allocation — a rule that decides a 400 must not be read out of a blob. The
 * snapshot stays what it always was: point-in-time provenance.
 *
 * ABSENCE IS NOT AN EMPTY ALLOCATION. Every run created before this link has
 * zero rows here, and so does any run approved without a `materials` array.
 * Those runs keep the old behaviour (the whole design BOM is available) — the
 * enforcement only engages once someone has actually made a selection. A run
 * with rows here is constrained to them; a run with none is unconstrained.
 */
export default defineLink(
  { linkable: ProductionRunsModule.linkable.productionRuns, isList: true },
  { linkable: InventoryModule.linkable.inventoryItem, isList: true },
  {
    database: {
      extraColumns: {
        /**
         * How much of this item the run was allocated. Null = unspecified.
         *
         * 🔴 `type: "decimal"` alone lands as `numeric(10,0)` — scale ZERO. A
         * partner issued 2.5 kg of warp had 3 recorded, silently, with the
         * picker offering `step="0.01"` the whole time. Half a metre of silk is
         * an ordinary quantity here, so the default is simply wrong for this
         * column; the explicit columnType is what makes the stored number the
         * number that was typed.
         */
        planned_quantity: {
          type: "decimal",
          nullable: true,
          options: { columnType: "numeric(20,6)" },
        },
        /** Where the material is issued FROM, when it differs from the design's. */
        location_id: { type: "text", nullable: true },
        /**
         * #817 S4 — the colour actually chosen for THIS run. The design↔group
         * link carries a single `resolved_raw_material_id` for the whole design,
         * so two runs of one design in two colours collide there. Per-run is the
         * only grain at which that answer is true.
         */
        resolved_raw_material_id: { type: "text", nullable: true },
        note: { type: "text", nullable: true },
        metadata: { type: "json", nullable: true },
      },
    },
  }
)
