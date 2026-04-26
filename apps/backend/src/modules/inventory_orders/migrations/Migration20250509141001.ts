import { Migration } from '@mikro-orm/migrations';

export class Migration20250509141001 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "inventory_order_line" drop constraint if exists "inventory_order_line_inventory_orders_id_foreign";`);

    this.addSql(`alter table if exists "inventory_order_line" add constraint "inventory_order_line_inventory_orders_id_foreign" foreign key ("inventory_orders_id") references "inventory_orders" ("id") on update cascade on delete cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "inventory_order_line" drop constraint if exists "inventory_order_line_inventory_orders_id_foreign";`);

    this.addSql(`alter table if exists "inventory_order_line" add constraint "inventory_order_line_inventory_orders_id_foreign" foreign key ("inventory_orders_id") references "inventory_orders" ("id") on update cascade;`);
  }

}
