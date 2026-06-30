import { Migration } from "@mikro-orm/migrations";

/**
 * #778 H9 — add `currency_code` to inventory orders. Previously absent, so the
 * dual-write to the unified order assumed INR (currency_assumed:true). Existing
 * rows were all created under that INR assumption, so backfill them to 'inr'.
 *
 * Hand-written idempotent ALTER (never edit the create-table migration — it only
 * runs on fresh DBs; recurring on-main hazard).
 */
export class Migration20260630180000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table if exists "inventory_orders" add column if not exists "currency_code" text not null default 'inr';`);
    // Backfill any rows that somehow predate the default (defensive).
    this.addSql(`update "inventory_orders" set "currency_code" = 'inr' where "currency_code" is null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "inventory_orders" drop column if exists "currency_code";`);
  }
}
