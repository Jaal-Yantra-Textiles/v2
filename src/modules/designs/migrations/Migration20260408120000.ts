import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260408120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "design" add column if not exists "revised_from_id" text null, add column if not exists "revision_number" integer not null default 1, add column if not exists "revision_notes" text null;`);
    this.addSql(`alter table if exists "design" alter column "status" type text;`);
    this.addSql(`create index if not exists "IDX_design_revised_from_id" on "design" ("revised_from_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_design_revised_from_id";`);
    this.addSql(`alter table if exists "design" drop column if exists "revised_from_id", drop column if exists "revision_number", drop column if exists "revision_notes";`);
  }

}
