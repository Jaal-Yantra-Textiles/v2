import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Promote the inventory-apply guard out of the `metadata` JSON blob.
 *
 * `metadata.inventory_applied_at` is the idempotency key for stock deduction:
 * the apply job skips any log that carries it. Inside a JSON column that guard
 * survived only because every writer remembered to spread the existing object,
 * so a single wholesale `metadata: body.metadata` write would have cleared it
 * without erroring — and the next apply run would have deducted the same
 * material twice.
 *
 * Existing values are copied across here rather than left to the backfill job,
 * so there is no window in which a legacy row looks unapplied. The metadata
 * keys are deliberately NOT dropped: this migration is reversible, and a
 * rollback that had already deleted them would resurrect the double-deduction.
 * `backfill-consumption-applied-columns` retires them separately once this has
 * been live long enough to trust.
 */
export class Migration20260826180000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "consumption_log" add column if not exists "inventory_applied_at" timestamptz null;`);
    this.addSql(`alter table if exists "consumption_log" add column if not exists "inventory_applied_location_id" text null;`);

    // Copy the legacy keys forward. `->>` yields NULL for a missing key, and the
    // WHERE guard keeps this a no-op on a re-run.
    this.addSql(`update "consumption_log" set "inventory_applied_at" = ("metadata"->>'inventory_applied_at')::timestamptz where "inventory_applied_at" is null and "metadata"->>'inventory_applied_at' is not null;`);
    this.addSql(`update "consumption_log" set "inventory_applied_location_id" = "metadata"->>'inventory_applied_location_id' where "inventory_applied_location_id" is null and "metadata"->>'inventory_applied_location_id' is not null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "consumption_log" drop column if exists "inventory_applied_at";`);
    this.addSql(`alter table if exists "consumption_log" drop column if exists "inventory_applied_location_id";`);
  }

}
