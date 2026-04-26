import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260321093121 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "website" drop column if exists "analytics_id";`);

    this.addSql(`alter table if exists "website" add column if not exists "theme" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "website" drop column if exists "theme";`);

    this.addSql(`alter table if exists "website" add column if not exists "analytics_id" text null;`);
  }

}
