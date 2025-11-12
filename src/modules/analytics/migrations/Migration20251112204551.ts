import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20251112204551 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "analytics_event" add column if not exists "utm_source" text null, add column if not exists "utm_medium" text null, add column if not exists "utm_campaign" text null, add column if not exists "utm_term" text null, add column if not exists "utm_content" text null, add column if not exists "query_string" text null, add column if not exists "is_404" boolean not null default false;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "analytics_event" drop column if exists "utm_source", drop column if exists "utm_medium", drop column if exists "utm_campaign", drop column if exists "utm_term", drop column if exists "utm_content", drop column if exists "query_string", drop column if exists "is_404";`);
  }

}
