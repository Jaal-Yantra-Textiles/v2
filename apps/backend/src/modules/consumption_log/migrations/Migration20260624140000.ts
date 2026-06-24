import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Repair migration — widen the `consumption_type` check constraint on
 * `consumption_log` to include the energy/labor values.
 *
 * Why this is needed (#697): the model enum
 * (`models/consumption-log.ts`) AND the `create table` statement in
 * `Migration20260414104644` both already list all 7 values
 * (`sample`, `production`, `wastage`, `energy_electricity`,
 * `energy_water`, `energy_gas`, `labor`). But on databases where
 * `consumption_log` was first created by that migration BEFORE the
 * energy and labor values were added, the `create table IF NOT EXISTS`
 * was a no-op on every later run, so the live check constraint still
 * only permits the original narrow set
 * (`sample`, `production`, `wastage`). No ALTER ever widened it.
 *
 * Symptom on prod (verified 2026-06-24): the
 * `backfill-finished-run-consumption` job applied but every labor/energy
 * INSERT was rejected with
 * `new row for relation "consumption_log" violates check constraint
 *  "consumption_log_consumption_type_check"` — so production-run
 * cost-summary energy/labor totals stayed 0.
 *
 * `medusa db:generate` produces NO diff here (model and snapshot already
 * match), so this drift can only be fixed with a hand-written ALTER.
 *
 * The constraint name is MikroORM's inline-column-check convention:
 * `<table>_<column>_check` = `consumption_log_consumption_type_check`
 * (confirmed by the prod error message).
 *
 * drop-if-exists + re-add makes this idempotent and safe to run on DBs
 * that already have the wide constraint (created fresh from the newer
 * create statement).
 *
 * AFTER deploy: re-run the `backfill-finished-run-consumption` job
 * (dry-run → apply) via Settings → Data Plumbing for the energy/labor
 * logs to actually land.
 */
export class Migration20260624140000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "consumption_log" drop constraint if exists "consumption_log_consumption_type_check";`
    );
    this.addSql(
      `alter table if exists "consumption_log" add constraint "consumption_log_consumption_type_check" check ("consumption_type" in ('sample', 'production', 'wastage', 'energy_electricity', 'energy_water', 'energy_gas', 'labor'));`
    );
  }

  override async down(): Promise<void> {
    // Widening is non-destructive; the prior narrower set is not reliably
    // known across DBs, so re-add the same wide constraint rather than
    // guessing and rejecting rows that were valid at down-migration time.
    this.addSql(
      `alter table if exists "consumption_log" drop constraint if exists "consumption_log_consumption_type_check";`
    );
    this.addSql(
      `alter table if exists "consumption_log" add constraint "consumption_log_consumption_type_check" check ("consumption_type" in ('sample', 'production', 'wastage', 'energy_electricity', 'energy_water', 'energy_gas', 'labor'));`
    );
  }
}
