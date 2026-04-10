import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260410031716 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "analytics_session" add column if not exists "utm_source" text null, add column if not exists "utm_medium" text null, add column if not exists "utm_campaign" text null, add column if not exists "utm_term" text null, add column if not exists "utm_content" text null;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_analytics_session_utm_campaign" ON "analytics_session" ("utm_campaign") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_analytics_session_utm_campaign";`);
    this.addSql(`alter table if exists "analytics_session" drop column if exists "utm_source", drop column if exists "utm_medium", drop column if exists "utm_campaign", drop column if exists "utm_term", drop column if exists "utm_content";`);
  }

}
