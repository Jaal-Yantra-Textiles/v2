import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * #829 — Material Group global specs.
 *
 * Adds the "set once, inherited by every color" fields onto `raw_material_group`:
 * default cost, lead time, MOQ, and a default receiving stock location. New
 * per-color raw_materials inherit these fill-blank on quick-add / create.
 *
 * Hand-written idempotent ALTER (add-column-if-not-exists): `raw_material_group`
 * already exists on live DBs from Migration20260701120000, so editing that
 * create-table would never land the new columns on existing databases (the
 * create-if-not-exists migration hazard).
 */
export class Migration20260701140000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "raw_material_group" add column if not exists "unit_cost" real null;`);
    this.addSql(`alter table if exists "raw_material_group" add column if not exists "cost_currency" text null;`);
    this.addSql(`alter table if exists "raw_material_group" add column if not exists "lead_time_days" integer null;`);
    this.addSql(`alter table if exists "raw_material_group" add column if not exists "minimum_order_quantity" integer null;`);
    this.addSql(`alter table if exists "raw_material_group" add column if not exists "stock_location_id" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "raw_material_group" drop column if exists "unit_cost";`);
    this.addSql(`alter table if exists "raw_material_group" drop column if exists "cost_currency";`);
    this.addSql(`alter table if exists "raw_material_group" drop column if exists "lead_time_days";`);
    this.addSql(`alter table if exists "raw_material_group" drop column if exists "minimum_order_quantity";`);
    this.addSql(`alter table if exists "raw_material_group" drop column if exists "stock_location_id";`);
  }

}
