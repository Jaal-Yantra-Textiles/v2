import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * #1123 — enforce "at most one ACTIVE production run per order line item" at the
 * database level. The idempotency guard (`getProductionRunForLineItem`) is a
 * read-then-write check with no constraint, so concurrent / redelivered
 * `order.fulfillment_created` events (or order.placed racing fulfillment) could
 * both pass it and double-create. This partial unique index closes that race —
 * the loser gets a unique_violation, which the reconcile path treats as a no-op.
 *
 * Partial on two predicates:
 *   - `order_line_item_id is not null` — design/partner runs without a line item
 *     (parent runs, samples) are unconstrained.
 *   - `deleted_at is null` — a soft-deleted provenance run (canceled fulfillment)
 *     must not block re-minting if the line is fulfilled again later.
 *
 * Hand-written incremental (the generator emits a full snapshot). See memory
 * `reference_medusa_migration_create_if_not_exists_hazard`.
 */
export class Migration20260722120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create unique index if not exists "IDX_production_runs_order_line_item_active" on "production_runs" ("order_line_item_id") where "order_line_item_id" is not null and "deleted_at" is null;`
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `drop index if exists "IDX_production_runs_order_line_item_active";`
    );
  }
}
