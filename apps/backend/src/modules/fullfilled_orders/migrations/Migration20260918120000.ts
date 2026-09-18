import { Migration } from "@mikro-orm/migrations";

/**
 * #2144 — a goods transfer can move MATERIAL, not only a run's finished output.
 *
 * Cloth delivered to a partner's bench and sent on to our warehouse (or to a
 * second partner) is a real movement with no production run behind it: nothing
 * was produced, so there is no approval to gate it, and the item cannot be
 * derived from a run's variant. Both facts need a column.
 *
 * HAND-WRITTEN, not `db:generate`d. This module carries no MikroORM snapshot,
 * so the generator rebuilds every model it sees and its `down()` would drop the
 * live `goods_transfer` and `inventory_shipment` tables on a rollback that only
 * ever intended to touch two columns. Same reasoning as Migration20260917103000
 * and Migration20260808165525.
 *
 * Both changes are widening: every existing row keeps its `production_run_id`
 * and reads null for `inventory_item_id`, which is the truth about them — they
 * were all run output.
 */
export class Migration20260918120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "goods_transfer" alter column "production_run_id" drop not null;`
    );
    this.addSql(
      `alter table if exists "goods_transfer" add column if not exists "inventory_item_id" text null;`
    );
  }

  override async down(): Promise<void> {
    // Drops ONLY the column this migration added. Never the table.
    this.addSql(
      `alter table if exists "goods_transfer" drop column if exists "inventory_item_id";`
    );
    /**
     * 🔴 `production_run_id` is deliberately NOT returned to NOT NULL.
     *
     * By the time anyone rolls back, material transfers may exist — and every
     * one of them has a null there. Re-imposing the constraint would fail the
     * rollback outright, or, if the rows were deleted first, destroy records of
     * real stock movements to satisfy a constraint. A column that is wider than
     * it needs to be is harmless; losing a movement is not.
     */
  }

}
