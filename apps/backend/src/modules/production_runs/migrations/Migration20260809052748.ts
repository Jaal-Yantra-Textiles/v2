import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260809052748 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "production_runs" add column if not exists "reassign_retry_count" integer not null default 0;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "production_runs" drop column if exists "reassign_retry_count";`);
  }

}
