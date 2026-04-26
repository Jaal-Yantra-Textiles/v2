import { Migration } from '@mikro-orm/migrations';

export class Migration20250821160909 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "inventory_orders" alter column "quantity" type real using ("quantity"::real);`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "inventory_orders" alter column "quantity" type integer using ("quantity"::integer);`);
  }

}
