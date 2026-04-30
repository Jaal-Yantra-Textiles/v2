import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260430010000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "website" add column if not exists "analytics_provider" text check ("analytics_provider" in ('in_house', 'custom', 'off')) not null default 'in_house';`);
    this.addSql(`alter table if exists "website" add column if not exists "analytics_custom_head" text null;`);
    this.addSql(`alter table if exists "website" add column if not exists "analytics_custom_body_end" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "website" drop column if exists "analytics_provider";`);
    this.addSql(`alter table if exists "website" drop column if exists "analytics_custom_head";`);
    this.addSql(`alter table if exists "website" drop column if exists "analytics_custom_body_end";`);
  }

}
