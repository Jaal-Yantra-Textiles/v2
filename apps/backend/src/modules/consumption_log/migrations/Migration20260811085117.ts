import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260811085117 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "consumption_log" add column if not exists "quantity_basis" text check ("quantity_basis" in ('total', 'per_piece')) null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "consumption_log" drop column if exists "quantity_basis";`);
  }

}
