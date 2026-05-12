import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260512152434 extends Migration {

  override async up(): Promise<void> {
    // GoogleSearchConsoleSite — one row per bound GSC property
    this.addSql(`create table if not exists "google_search_console_site" (
      "id" text not null,
      "site_url" text not null,
      "permission_level" text null,
      "last_synced_at" timestamptz null,
      "sync_status" text check ("sync_status" in ('synced', 'syncing', 'error', 'pending')) not null default 'pending',
      "sync_error" text null,
      "binding_id" text null,
      "platform_id" text not null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "google_search_console_site_pkey" primary key ("id")
    );`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_google_search_console_site_platform_id" ON "google_search_console_site" ("platform_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_google_search_console_site_deleted_at" ON "google_search_console_site" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_google_search_console_site_url" ON "google_search_console_site" ("site_url") WHERE deleted_at IS NULL;`);

    // GoogleSearchConsoleInsights — daily Search Analytics rows
    this.addSql(`create table if not exists "google_search_console_insights" (
      "id" text not null,
      "date" text not null,
      "query" text null,
      "page" text null,
      "country" text null,
      "device" text null,
      "search_appearance" text null,
      "clicks" numeric not null default 0,
      "impressions" numeric not null default 0,
      "ctr" real null,
      "position" real null,
      "site_id" text not null,
      "raw" jsonb null,
      "synced_at" timestamptz not null,
      "raw_clicks" jsonb not null default '{"value":"0","precision":20}',
      "raw_impressions" jsonb not null default '{"value":"0","precision":20}',
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "google_search_console_insights_pkey" primary key ("id")
    );`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_google_search_console_insights_site_id" ON "google_search_console_insights" ("site_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_google_search_console_insights_deleted_at" ON "google_search_console_insights" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_google_search_console_insights_date" ON "google_search_console_insights" ("date") WHERE deleted_at IS NULL;`);

    // FK chain
    this.addSql(`alter table if exists "google_search_console_site" add constraint "google_search_console_site_platform_id_foreign" foreign key ("platform_id") references "social_platform" ("id") on update cascade;`);
    this.addSql(`alter table if exists "google_search_console_insights" add constraint "google_search_console_insights_site_id_foreign" foreign key ("site_id") references "google_search_console_site" ("id") on update cascade on delete cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "google_search_console_insights" cascade;`);
    this.addSql(`drop table if exists "google_search_console_site" cascade;`);
  }

}
