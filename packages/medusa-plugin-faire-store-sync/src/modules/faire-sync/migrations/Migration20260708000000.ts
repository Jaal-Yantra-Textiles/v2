import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260708000000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "faire_sync_settings" add column if not exists "last_order_sync_at" timestamptz null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "faire_sync_settings" drop column if exists "last_order_sync_at";`);
  }

}
