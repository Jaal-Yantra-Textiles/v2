import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Widens the design↔inventory link's quantities to `numeric(20,6)` (#2315).
 *
 * `type: "decimal"` with no column type lands as `numeric(10,0)`, so a design's
 * planned metres were rounded to whole numbers — 2.7 m of shawl fabric became
 * 3. The link definition now carries the explicit column type, which is enough
 * for a database built from scratch; this migration is for the ones that
 * already exist, where the link generator leaves an existing column alone.
 * Same fix as Migration20260826090000 on the run↔inventory link.
 *
 * Widening only: scale 0 → 6 loses nothing, and re-running is a no-op.
 */
export class Migration20260930120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`
      alter table if exists "design_design_inventory_inventory_item"
      alter column "planned_quantity" type numeric(20,6);
    `);
    this.addSql(`
      alter table if exists "design_design_inventory_inventory_item"
      alter column "consumed_quantity" type numeric(20,6);
    `);
  }

  /**
   * Deliberately not reversible: narrowing back to scale 0 would ROUND every
   * fractional quantity written since.
   */
  override async down(): Promise<void> {}

}
