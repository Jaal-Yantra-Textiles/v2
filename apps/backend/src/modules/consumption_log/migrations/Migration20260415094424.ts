import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260415094424 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "consumption_log" alter column "inventory_item_id" type text using ("inventory_item_id"::text);`);
    this.addSql(`alter table if exists "consumption_log" alter column "inventory_item_id" drop not null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "consumption_log" alter column "inventory_item_id" type text using ("inventory_item_id"::text);`);
    this.addSql(`alter table if exists "consumption_log" alter column "inventory_item_id" set not null;`);
  }

}
