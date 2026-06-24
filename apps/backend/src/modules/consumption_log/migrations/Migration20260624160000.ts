import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Repair migration (part 2 of #697) — widen the `unit_of_measure` check
 * constraint on `consumption_log` to include the energy/labor units.
 *
 * Why this is needed (#697): the model enum
 * (`models/consumption-log.ts`) AND the `create table` statement in
 * `Migration20260414104644` both already list all 11 values
 * (`Meter`, `Yard`, `Kilogram`, `Gram`, `Piece`, `Roll`, `kWh`,
 * `Liter`, `Cubic_Meter`, `Hour`, `Other`). But on databases where
 * `consumption_log` was first created by that migration BEFORE the
 * later units were added, the `create table IF NOT EXISTS` was a no-op
 * on every later run, so the live check constraint still only permits
 * the original narrow set. No ALTER ever widened it.
 *
 * This is the SAME create-if-not-exists drift that #711
 * (`Migration20260624140000`) fixed on the `consumption_type` column —
 * but on a SECOND column. After #711 applied on prod (boot log
 * "✔ Migrated Migration20260624140000" 2026-06-24 09:25), the
 * `backfill-finished-run-consumption` job got past the
 * `consumption_type` check (it passes `'labor'`) only to be rejected by
 * the NEXT constraint:
 *   `new row for relation "consumption_log" violates check constraint
 *    "consumption_log_unit_of_measure_check"` — failing value
 *   `unit_of_measure = 'Hour'`.
 * The backfill inserts `unit_of_measure='Hour'` (labor) and `'kWh'`
 * (energy), neither of which the stale prod constraint allows, so
 * production-run cost-summary energy/labor totals stayed 0.
 *
 * `medusa db:generate` produces NO diff here (model and snapshot already
 * match), so this drift can only be fixed with a hand-written ALTER.
 *
 * The constraint names are MikroORM's inline-column-check convention:
 * `<table>_<column>_check`.
 *
 * drop-if-exists + re-add makes each ALTER idempotent and safe to run on
 * DBs that already have the wide constraint (created fresh from the
 * newer create statement). We also defensively re-assert the other
 * `consumption_log` enum checks (`consumption_type`, `consumed_by`) so
 * the backfill cannot fail on a THIRD stale constraint.
 *
 * AFTER deploy: re-run the `backfill-finished-run-consumption` job
 * (dry-run → apply) via Settings → Data Plumbing for the energy/labor
 * logs to actually land (e.g. prod_run_01KMQ7SFAFV4AV7EJZADNG7D5W,
 * prod_run_01KKTX76V2VQZF2388BXTQ21QT).
 */
export class Migration20260624160000 extends Migration {
  override async up(): Promise<void> {
    // Primary fix: widen unit_of_measure to the full model enum (11 values).
    this.addSql(
      `alter table if exists "consumption_log" drop constraint if exists "consumption_log_unit_of_measure_check";`
    );
    this.addSql(
      `alter table if exists "consumption_log" add constraint "consumption_log_unit_of_measure_check" check ("unit_of_measure" in ('Meter', 'Yard', 'Kilogram', 'Gram', 'Piece', 'Roll', 'kWh', 'Liter', 'Cubic_Meter', 'Hour', 'Other'));`
    );

    // Defensive re-assert (idempotent) — mirror the model enums so the
    // backfill cannot trip a third stale check constraint.
    this.addSql(
      `alter table if exists "consumption_log" drop constraint if exists "consumption_log_consumption_type_check";`
    );
    this.addSql(
      `alter table if exists "consumption_log" add constraint "consumption_log_consumption_type_check" check ("consumption_type" in ('sample', 'production', 'wastage', 'energy_electricity', 'energy_water', 'energy_gas', 'labor'));`
    );
    this.addSql(
      `alter table if exists "consumption_log" drop constraint if exists "consumption_log_consumed_by_check";`
    );
    this.addSql(
      `alter table if exists "consumption_log" add constraint "consumption_log_consumed_by_check" check ("consumed_by" in ('admin', 'partner'));`
    );
  }

  override async down(): Promise<void> {
    // Widening is non-destructive; the prior narrower sets are not reliably
    // known across DBs, so re-add the same wide constraints rather than
    // guessing and rejecting rows that were valid at down-migration time.
    this.addSql(
      `alter table if exists "consumption_log" drop constraint if exists "consumption_log_unit_of_measure_check";`
    );
    this.addSql(
      `alter table if exists "consumption_log" add constraint "consumption_log_unit_of_measure_check" check ("unit_of_measure" in ('Meter', 'Yard', 'Kilogram', 'Gram', 'Piece', 'Roll', 'kWh', 'Liter', 'Cubic_Meter', 'Hour', 'Other'));`
    );
    this.addSql(
      `alter table if exists "consumption_log" drop constraint if exists "consumption_log_consumption_type_check";`
    );
    this.addSql(
      `alter table if exists "consumption_log" add constraint "consumption_log_consumption_type_check" check ("consumption_type" in ('sample', 'production', 'wastage', 'energy_electricity', 'energy_water', 'energy_gas', 'labor'));`
    );
    this.addSql(
      `alter table if exists "consumption_log" drop constraint if exists "consumption_log_consumed_by_check";`
    );
    this.addSql(
      `alter table if exists "consumption_log" add constraint "consumption_log_consumed_by_check" check ("consumed_by" in ('admin', 'partner'));`
    );
  }
}
