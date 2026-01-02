import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260101094936 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "production_runs" add column if not exists "parent_run_id" text null, add column if not exists "role" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "production_runs" drop column if exists "parent_run_id", drop column if exists "role";`);
  }

}
