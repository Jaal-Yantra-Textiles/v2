import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * What makes the balance due, and the sample approval that can release it.
 *
 * `balance_trigger` defaults to `dispatch`, which is exactly what every
 * existing schedule already does, so existing rows keep their behaviour with
 * no backfill. The two sample columns are null until a buyer approves one.
 */
export class Migration20261009170000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "payment_schedule" add column if not exists "balance_trigger" text check ("balance_trigger" in ('dispatch', 'sample_approved', 'manual')) not null default 'dispatch';`
    )
    this.addSql(
      `alter table if exists "payment_schedule" add column if not exists "sample_approved_at" timestamptz null;`
    )
    this.addSql(
      `alter table if exists "payment_schedule" add column if not exists "sample_run_id" text null;`
    )
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "payment_schedule" drop column if exists "sample_run_id";`)
    this.addSql(`alter table if exists "payment_schedule" drop column if exists "sample_approved_at";`)
    this.addSql(`alter table if exists "payment_schedule" drop column if exists "balance_trigger";`)
  }
}
