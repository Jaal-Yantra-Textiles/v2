import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * #2646 / Chirag order #178 — an order-linked run could never be approved.
 *
 * #1123 (Migration20260722120000) made `order_line_item_id` unique among
 * active runs. But approving a run creates one CHILD per partner, and each
 * child copies the parent's `order_line_item_id` (approve-production-run.ts),
 * so the first child collided with its own parent: 400 "Production runs with
 * order_line_item_id … already exists". Every run minted at `order.placed`
 * was unapprovable.
 *
 * The #1123 race it guards is between TOP-LEVEL provenance runs (order.placed
 * vs order.fulfillment_created minting twice for one line). Children are not
 * minted by those subscribers, so the index now covers top-level runs only.
 *
 * Hand-written incremental. Drop + create: an index predicate can't be altered
 * in place, and `create … if not exists` would keep the old predicate.
 */
export class Migration20261126120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `drop index if exists "IDX_production_runs_order_line_item_active";`
    );
    this.addSql(
      `create unique index if not exists "IDX_production_runs_order_line_item_active" on "production_runs" ("order_line_item_id") where "order_line_item_id" is not null and "deleted_at" is null and "parent_run_id" is null;`
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `drop index if exists "IDX_production_runs_order_line_item_active";`
    );
    this.addSql(
      `create unique index if not exists "IDX_production_runs_order_line_item_active" on "production_runs" ("order_line_item_id") where "order_line_item_id" is not null and "deleted_at" is null;`
    );
  }
}
