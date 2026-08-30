import { Migration } from "@mikro-orm/migrations";

/**
 * #1596 — short-close a production run.
 *
 * A run ordered for 9 and completed at 7 keeps 2 units billable forever: the
 * write guard's ceiling is the ORDERED quantity, and that number cannot tell
 * "not made yet" from "never will be made". These columns carry the statement
 * that settles it, after which the ceiling is the produced quantity instead.
 *
 * Typed columns, not metadata: this decides how much a partner may still claim
 * (#1557 — a metadata blob is not a contract).
 *
 * All nullable and defaulted to NULL, so every existing run reads exactly as it
 * did before: not short-closed, billable to its ordered quantity.
 */
export class Migration20260830150000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`
      alter table if exists "production_runs"
        add column if not exists "short_closed_at" timestamptz null,
        add column if not exists "short_closed_by" text null,
        add column if not exists "short_close_reason" text null,
        add column if not exists "short_closed_quantity" numeric(20,6) null;
    `);

    // The counter sweeps for completed, not-yet-closed runs; this keeps that
    // scan off a full table read as the run table grows.
    this.addSql(`
      create index if not exists "IDX_production_runs_short_close_sweep"
        on "production_runs" ("status", "short_closed_at")
        where "deleted_at" is null;
    `);
  }

  /**
   * Reversible: dropping the columns restores the ordered-quantity ceiling for
   * every run, which is exactly the pre-migration behaviour. It DOES discard
   * the record of who closed what and why — acceptable only because nothing
   * downstream stores a decision that depends on it.
   */
  override async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_production_runs_short_close_sweep";`);
    this.addSql(`
      alter table if exists "production_runs"
        drop column if exists "short_closed_at",
        drop column if exists "short_closed_by",
        drop column if exists "short_close_reason",
        drop column if exists "short_closed_quantity";
    `);
  }

}
