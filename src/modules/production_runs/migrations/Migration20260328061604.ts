import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260328061604 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "production_runs" add column if not exists "produced_quantity" real null, add column if not exists "rejected_quantity" real null, add column if not exists "rejection_reason" text null, add column if not exists "rejection_notes" text null, add column if not exists "cost_type" text check ("cost_type" in ('per_unit', 'total')) null default 'total';`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "production_runs" drop column if exists "produced_quantity", drop column if exists "rejected_quantity", drop column if exists "rejection_reason", drop column if exists "rejection_notes", drop column if exists "cost_type";`);
  }

}
