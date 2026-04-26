import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260421000000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "partner" add column if not exists "vercel_last_deployment_id" text null;`);
    this.addSql(`alter table if exists "partner" add column if not exists "storefront_repo" text null;`);
    this.addSql(`alter table if exists "partner" add column if not exists "storefront_root_dir" text null;`);
    this.addSql(`alter table if exists "partner" add column if not exists "storefront_branch" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "partner" drop column if exists "vercel_last_deployment_id";`);
    this.addSql(`alter table if exists "partner" drop column if exists "storefront_repo";`);
    this.addSql(`alter table if exists "partner" drop column if exists "storefront_root_dir";`);
    this.addSql(`alter table if exists "partner" drop column if exists "storefront_branch";`);
  }

}
