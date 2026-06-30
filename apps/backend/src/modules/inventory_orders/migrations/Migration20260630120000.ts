import { Migration } from '@mikro-orm/migrations';

/**
 * #790 — add the new "Ready for Delivery" inventory-order status (goods packed
 * and ready to hand to the carrier, before the shipment/AWB is created).
 *
 * Hand-written idempotent ALTER (mirrors Migration20250810071843, which added
 * 'Partial') — DROP IF EXISTS then re-add the check constraint with the new
 * value. NEVER edit the create-table migration: that only runs on fresh DBs and
 * would never land the new value on existing/prod databases (recurring hazard).
 */
export class Migration20260630120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "inventory_orders" drop constraint if exists "inventory_orders_status_check";`);

    this.addSql(`alter table if exists "inventory_orders" add constraint "inventory_orders_status_check" check("status" in ('Pending', 'Processing', 'Ready for Delivery', 'Shipped', 'Delivered', 'Cancelled', 'Partial'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "inventory_orders" drop constraint if exists "inventory_orders_status_check";`);

    this.addSql(`alter table if exists "inventory_orders" add constraint "inventory_orders_status_check" check("status" in ('Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled', 'Partial'));`);
  }

}
