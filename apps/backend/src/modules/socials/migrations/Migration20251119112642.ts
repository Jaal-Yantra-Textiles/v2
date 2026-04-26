import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20251119112642 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "social_platform" add column if not exists "category" text not null default 'social', add column if not exists "auth_type" text not null default 'oauth2', add column if not exists "description" text null, add column if not exists "status" text not null default 'active';`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "social_platform" drop column if exists "category", drop column if exists "auth_type", drop column if exists "description", drop column if exists "status";`);
  }

}
