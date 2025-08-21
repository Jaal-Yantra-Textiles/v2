import { Migration } from '@mikro-orm/migrations';

export class Migration20250821160920 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "inventory_order_line" alter column "quantity" type real using ("quantity"::real);`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "inventory_order_line" alter column "quantity" type integer using ("quantity"::integer);`);
  }

}
