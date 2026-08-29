import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * `payment_submission.paid_at` — when money actually moved, as distinct from
 * `status: "Paid"`, which approval sets before anything has demonstrably been
 * sent (#1636).
 *
 * The generator also wanted to add five `payment_submission_item` columns
 * (`quantity`, `unit_amount`, `production_run_ids`, `run_provenance`,
 * `raw_unit_amount`). Those already exist in the live schema — an earlier
 * hand-written migration added them and no snapshot was regenerated. Dropped
 * from this migration rather than carried as `if not exists` no-ops.
 */
export class Migration20260829001519 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "payment_submission" add column if not exists "paid_at" timestamptz null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "payment_submission" drop column if exists "paid_at";`);
  }

}
