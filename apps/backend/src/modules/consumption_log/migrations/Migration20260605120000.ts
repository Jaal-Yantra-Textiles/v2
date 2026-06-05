import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Repair migration — add `production_run_id` to `consumption_log`.
 *
 * Why this is needed: the column was added to the model AND edited into
 * the `create table` statement of `Migration20260414104644` in place,
 * but no incremental ALTER was ever shipped. Because that migration
 * uses `create table IF NOT EXISTS`, any database that created
 * `consumption_log` before the column was added never received it — and
 * the guard means re-running the create can't fix it. Result: queries
 * filtering consumption_log by `production_run_id` (production-run
 * cost-summary, run consumption logs) fail with
 * `column "production_run_id" of relation "consumption_log" does not exist`.
 *
 * `add column if not exists` makes this safe everywhere: DBs missing the
 * column get it; DBs that already have it (created fresh from the newer
 * create statement) skip it.
 */
export class Migration20260605120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "consumption_log" add column if not exists "production_run_id" text null;`
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table if exists "consumption_log" drop column if exists "production_run_id";`
    );
  }
}
