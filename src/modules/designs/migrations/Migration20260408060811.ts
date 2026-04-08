import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260408060811 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "design" drop constraint if exists "design_status_check";`);

    this.addSql(`alter table if exists "design" add column if not exists "revised_from_id" text null, add column if not exists "revision_number" integer not null default 1, add column if not exists "revision_notes" text null;`);
    this.addSql(`alter table if exists "design" add constraint "design_status_check" check("status" in ('Conceptual', 'In_Development', 'Technical_Review', 'Sample_Production', 'Revision', 'Approved', 'Rejected', 'On_Hold', 'Commerce_Ready', 'Superseded'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "design" drop constraint if exists "design_status_check";`);

    this.addSql(`alter table if exists "design" drop column if exists "revised_from_id", drop column if exists "revision_number", drop column if exists "revision_notes";`);

    this.addSql(`alter table if exists "design" add constraint "design_status_check" check("status" in ('Conceptual', 'In_Development', 'Technical_Review', 'Sample_Production', 'Revision', 'Approved', 'Rejected', 'On_Hold', 'Commerce_Ready'));`);
  }

}
