import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * The per-assignment material allocation could not hold half a metre.
 *
 * `production-run-inventory-link.ts` declares `planned_quantity` as
 * `{ type: "decimal" }`, and Medusa's link schema generator turns a bare
 * `decimal` into **`numeric(10,0)` — scale ZERO**. Postgres rounds on the way
 * in, so a partner issued 2.5 kg of warp had **3** recorded, silently, while
 * the admin picker offered a `step="0.01"` box the whole time. Half a metre of
 * silk is an ordinary quantity in this business; the default is simply wrong
 * for this column.
 *
 * The link definition now carries `options: { columnType: "numeric(20,6)" }`,
 * which is enough for a database built from scratch. This migration is for the
 * ones that already exist — CI's template, every developer's copy, and
 * production — where the column is already there and the generator leaves it
 * alone.
 *
 * Widening only: scale 0 → 6 loses nothing, every stored value is already a
 * whole number, and re-running is a no-op.
 *
 * ⚠️ `design_design_inventory_inventory_item.planned_quantity` has the SAME
 * defect and is deliberately NOT touched here — the design's bill of materials
 * feeds the design cost engine, and changing what a BOM quantity can express is
 * a bigger decision than fixing the column an operator just typed into.
 */
export class Migration20260826090000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`
      alter table if exists "production_runs_production_runs_inventory_inventory_item"
      alter column "planned_quantity" type numeric(20,6);
    `);
  }

  /**
   * Deliberately not reversible. Narrowing back to scale 0 would ROUND every
   * fractional quantity written since — a `down` that silently corrupts data is
   * worse than one that refuses.
   */
  override async down(): Promise<void> {}

}
