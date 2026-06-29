import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * #778 C4 — cancellation audit columns on inventory_orders.
 *
 * Hand-written and idempotent (`add column if not exists`) so it applies
 * cleanly on existing databases regardless of MikroORM's create-table
 * snapshot, per the project's migration hazard (a column added by editing a
 * `create table` migration never lands on already-migrated DBs).
 */
export class Migration20260629120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "inventory_orders" add column if not exists "cancelled_at" timestamptz null;`);
    this.addSql(`alter table if exists "inventory_orders" add column if not exists "cancellation_reason" text null;`);
    this.addSql(`alter table if exists "inventory_orders" add column if not exists "cancelled_by" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "inventory_orders" drop column if exists "cancelled_at";`);
    this.addSql(`alter table if exists "inventory_orders" drop column if exists "cancellation_reason";`);
    this.addSql(`alter table if exists "inventory_orders" drop column if exists "cancelled_by";`);
  }

}
