import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Split "may we export from here" out of "do we own the stock here" (#1498).
 *
 * NULLABLE with no default and no backfill, deliberately. Every existing row
 * keeps saying nothing, the resolver keeps inferring from `is_core` while that
 * is true of the whole set, and the behaviour on prod does not move until an
 * operator marks the first real export hub. A backfill here would have written
 * "Dharamshala is an export origin" as though somebody had decided it.
 *
 * One additive nullable column — idempotent and safe to re-run (#1208).
 */
export class Migration20260824150000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "location_ownership" add column if not exists "is_export_origin" boolean null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "location_ownership" drop column if exists "is_export_origin";`);
  }

}
