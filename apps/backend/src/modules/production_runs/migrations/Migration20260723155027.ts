import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260723155027 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "production_runs" drop constraint if exists "production_runs_status_check";`);

    this.addSql(`alter table if exists "production_runs" add column if not exists "reminder_count" integer not null default 0, add column if not exists "reminder_kind" text null, add column if not exists "last_reminded_at" timestamptz null, add column if not exists "reminder_status" text check ("reminder_status" in ('active', 'escalated', 'closed')) null, add column if not exists "previous_partner_id" text null;`);
    this.addSql(`alter table if exists "production_runs" alter column "design_id" type text using ("design_id"::text);`);
    this.addSql(`alter table if exists "production_runs" alter column "design_id" drop not null;`);
    this.addSql(`alter table if exists "production_runs" add constraint "production_runs_status_check" check("status" in ('draft', 'pending_review', 'approved', 'sent_to_partner', 'in_progress', 'completed', 'cancelled', 'awaiting_reassignment'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "production_runs" drop constraint if exists "production_runs_status_check";`);

    this.addSql(`alter table if exists "production_runs" drop column if exists "reminder_count", drop column if exists "reminder_kind", drop column if exists "last_reminded_at", drop column if exists "reminder_status", drop column if exists "previous_partner_id";`);

    this.addSql(`alter table if exists "production_runs" alter column "design_id" type text using ("design_id"::text);`);
    this.addSql(`alter table if exists "production_runs" alter column "design_id" set not null;`);
    this.addSql(`alter table if exists "production_runs" add constraint "production_runs_status_check" check("status" in ('draft', 'pending_review', 'approved', 'sent_to_partner', 'in_progress', 'completed', 'cancelled'));`);
  }

}
