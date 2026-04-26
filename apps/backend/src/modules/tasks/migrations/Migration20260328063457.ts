import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260328063457 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "task" add column if not exists "estimated_cost" real null, add column if not exists "actual_cost" real null, add column if not exists "cost_currency" text null, add column if not exists "cost_type" text check ("cost_type" in ('per_unit', 'total')) null default 'total';`);

    this.addSql(`alter table if exists "task_template" add column if not exists "estimated_cost" real null, add column if not exists "cost_currency" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "task" drop column if exists "estimated_cost", drop column if exists "actual_cost", drop column if exists "cost_currency", drop column if exists "cost_type";`);

    this.addSql(`alter table if exists "task_template" drop column if exists "estimated_cost", drop column if exists "cost_currency";`);
  }

}
