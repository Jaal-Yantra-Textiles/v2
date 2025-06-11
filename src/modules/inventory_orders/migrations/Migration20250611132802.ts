import { Migration } from '@mikro-orm/migrations';

export class Migration20250611132802 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "inventory_orders" add column if not exists "is_sample" boolean not null default false;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "inventory_orders" drop column if exists "is_sample";`);
  }

}
