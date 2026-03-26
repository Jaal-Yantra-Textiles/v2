import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260326111138 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "production_runs" add column if not exists "cancelled_at" timestamptz null, add column if not exists "cancelled_reason" text null, add column if not exists "finish_notes" text null, add column if not exists "completion_notes" text null, add column if not exists "partner_cost_estimate" real null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "production_runs" drop column if exists "cancelled_at", drop column if exists "cancelled_reason", drop column if exists "finish_notes", drop column if exists "completion_notes", drop column if exists "partner_cost_estimate";`);
  }

}
