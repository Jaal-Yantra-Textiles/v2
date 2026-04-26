import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260326051017 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "raw_materials" add column if not exists "unit_cost" real null, add column if not exists "cost_currency" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "raw_materials" drop column if exists "unit_cost", drop column if exists "cost_currency";`);
  }

}
