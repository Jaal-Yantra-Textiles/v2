import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260305151334 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "inventory_orders" alter column "expected_delivery_date" type timestamptz using ("expected_delivery_date"::timestamptz);`);
    this.addSql(`alter table if exists "inventory_orders" alter column "expected_delivery_date" drop not null;`);
    this.addSql(`alter table if exists "inventory_orders" alter column "order_date" type timestamptz using ("order_date"::timestamptz);`);
    this.addSql(`alter table if exists "inventory_orders" alter column "order_date" drop not null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "inventory_orders" alter column "expected_delivery_date" type timestamptz using ("expected_delivery_date"::timestamptz);`);
    this.addSql(`alter table if exists "inventory_orders" alter column "expected_delivery_date" set not null;`);
    this.addSql(`alter table if exists "inventory_orders" alter column "order_date" type timestamptz using ("order_date"::timestamptz);`);
    this.addSql(`alter table if exists "inventory_orders" alter column "order_date" set not null;`);
  }

}
