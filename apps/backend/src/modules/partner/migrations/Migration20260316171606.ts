import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260316171606 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "partner" add column if not exists "storefront_domain" text null, add column if not exists "website_id" text null, add column if not exists "vercel_project_id" text null, add column if not exists "vercel_project_name" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "partner" drop column if exists "storefront_domain", drop column if exists "website_id", drop column if exists "vercel_project_id", drop column if exists "vercel_project_name";`);
  }

}
