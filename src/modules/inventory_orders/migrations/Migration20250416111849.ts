import { Migration } from '@mikro-orm/migrations';

export class Migration20250416111849 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "inventory_orders" add column if not exists "raw_total_price" jsonb not null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "inventory_orders" drop column if exists "raw_total_price";`);
  }

}
