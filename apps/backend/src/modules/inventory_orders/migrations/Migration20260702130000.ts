import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Mass batches — add `batch_number` to `inventory_order_line`.
 *
 * When a material group is quick-added as N distinct batches ("keep batches as
 * separate lines"), each batch becomes its own order line tagged 1..N so it can
 * be priced/received/tracked independently. Null ⇒ not batched (a single summed
 * line), the default.
 *
 * Hand-written idempotent ALTER because the table already exists on live DBs
 * (the create-if-not-exists migration hazard). Existing lines stay null.
 */
export class Migration20260702130000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "inventory_order_line" add column if not exists "batch_number" integer null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "inventory_order_line" drop column if exists "batch_number";`);
  }

}
