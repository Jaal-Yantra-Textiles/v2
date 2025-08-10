import { Migration } from '@mikro-orm/migrations';

export class Migration20250810071843 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "inventory_orders" drop constraint if exists "inventory_orders_status_check";`);

    this.addSql(`alter table if exists "inventory_orders" add constraint "inventory_orders_status_check" check("status" in ('Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled', 'Partial'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "inventory_orders" drop constraint if exists "inventory_orders_status_check";`);

    this.addSql(`alter table if exists "inventory_orders" add constraint "inventory_orders_status_check" check("status" in ('Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled'));`);
  }

}
