import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * `payment_submission_item.rate_breakdown` — per-piece prices within one line
 * (#1596).
 *
 * Hand-written rather than generated: `db:generate` emits
 * `create table if not exists` for this module's tables, which is a silent
 * no-op wherever they already exist while still being recorded as applied.
 *
 * Nullable with no default. NULL means "one rate, see `unit_amount`", which is
 * every existing row and 20 of the 21 production lines.
 */
export class Migration20260829143000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "payment_submission_item" add column if not exists "rate_breakdown" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "payment_submission_item" drop column if exists "rate_breakdown";`);
  }

}
