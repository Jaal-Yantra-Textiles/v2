import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260301040849 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "production_runs" add column if not exists "depends_on_run_ids" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "production_runs" drop column if exists "depends_on_run_ids";`);
  }

}
