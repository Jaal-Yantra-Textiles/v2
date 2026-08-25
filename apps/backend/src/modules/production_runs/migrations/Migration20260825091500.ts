import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * #1529 — a chain stage can wait on goods, so a run records which inventory
 * orders it depends on.
 *
 * 🔴 This file was born as `Migration20260825090000` and NEVER RAN. Medusa
 * records every module's migrations in ONE shared `mikro_orm_migrations` table,
 * keyed on the class name alone — the module is not part of the key. The
 * partner-quote module shipped its own `Migration20260825090000` thirteen
 * minutes earlier, so by the time this module's migrator looked, the name was
 * already in the table and it reported "Database is up-to-date for module" and
 * skipped. No error, no warning, exit 0.
 *
 * The column was therefore absent everywhere the schema is built by migrations
 * — CI, every developer's database, and production — which 400'd every
 * production-run create and took ~40 integration spec files red.
 *
 * Renamed, so it is pending again. The SQL is additive and guarded, so it is
 * safe to run against a database that somehow already has the column.
 * `duplicate-migration-names.unit.spec.ts` now fails the build on a repeat.
 */
export class Migration20260825091500 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "production_runs" add column if not exists "depends_on_inventory_order_ids" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "production_runs" drop column if exists "depends_on_inventory_order_ids";`);
  }

}
