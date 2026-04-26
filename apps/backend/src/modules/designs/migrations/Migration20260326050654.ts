import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260326050654 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "design" add column if not exists "material_cost" numeric null, add column if not exists "production_cost" numeric null, add column if not exists "cost_breakdown" jsonb null, add column if not exists "cost_currency" text null, add column if not exists "raw_material_cost" jsonb null, add column if not exists "raw_production_cost" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "design" drop column if exists "material_cost", drop column if exists "production_cost", drop column if exists "cost_breakdown", drop column if exists "cost_currency", drop column if exists "raw_material_cost", drop column if exists "raw_production_cost";`);
  }

}
