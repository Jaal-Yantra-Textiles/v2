import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260411122856 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "partner" add column if not exists "workspace_type" text check ("workspace_type" in ('seller', 'manufacturer', 'individual')) not null default 'manufacturer';`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "partner" drop column if exists "workspace_type";`);
  }

}
