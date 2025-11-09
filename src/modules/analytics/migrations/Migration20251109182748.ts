import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20251109182748 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "analytics_session" drop constraint if exists "analytics_session_session_id_unique";`);
    this.addSql(`alter table if exists "analytics_daily_stats" drop constraint if exists "analytics_daily_stats_website_id_date_unique";`);
    this.addSql(`create table if not exists "analytics_daily_stats" ("id" text not null, "website_id" text not null, "date" timestamptz not null, "pageviews" integer not null default 0, "unique_visitors" integer not null default 0, "sessions" integer not null default 0, "bounce_rate" real not null default 0, "avg_session_duration" real not null default 0, "top_pages" jsonb null, "top_referrers" jsonb null, "top_countries" jsonb null, "desktop_visitors" integer not null default 0, "mobile_visitors" integer not null default 0, "tablet_visitors" integer not null default 0, "browser_stats" jsonb null, "os_stats" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "analytics_daily_stats_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_analytics_daily_stats_deleted_at" ON "analytics_daily_stats" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_analytics_daily_stats_website_id_date_unique" ON "analytics_daily_stats" ("website_id", "date") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_analytics_daily_stats_date" ON "analytics_daily_stats" ("date") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "analytics_event" ("id" text not null, "website_id" text not null, "event_type" text check ("event_type" in ('pageview', 'custom_event')) not null default 'pageview', "event_name" text null, "pathname" text not null, "referrer" text null, "referrer_source" text null, "visitor_id" text not null, "session_id" text not null, "user_agent" text null, "browser" text null, "os" text null, "device_type" text check ("device_type" in ('desktop', 'mobile', 'tablet', 'unknown')) not null default 'unknown', "country" text null, "metadata" jsonb null, "timestamp" timestamptz not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "analytics_event_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_analytics_event_deleted_at" ON "analytics_event" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_analytics_event_website_id_timestamp" ON "analytics_event" ("website_id", "timestamp") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_analytics_event_website_id_pathname_timestamp" ON "analytics_event" ("website_id", "pathname", "timestamp") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_analytics_event_session_id" ON "analytics_event" ("session_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_analytics_event_visitor_id" ON "analytics_event" ("visitor_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_analytics_event_website_id_event_type_timestamp" ON "analytics_event" ("website_id", "event_type", "timestamp") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "analytics_session" ("id" text not null, "website_id" text not null, "session_id" text not null, "visitor_id" text not null, "entry_page" text not null, "exit_page" text null, "pageviews" integer not null default 1, "duration_seconds" integer null, "is_bounce" boolean not null default false, "referrer" text null, "referrer_source" text null, "country" text null, "device_type" text null, "browser" text null, "os" text null, "started_at" timestamptz not null, "ended_at" timestamptz null, "last_activity_at" timestamptz not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "analytics_session_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_analytics_session_session_id_unique" ON "analytics_session" ("session_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_analytics_session_deleted_at" ON "analytics_session" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_analytics_session_website_id_started_at" ON "analytics_session" ("website_id", "started_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_analytics_session_visitor_id" ON "analytics_session" ("visitor_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_analytics_session_website_id_is_bounce" ON "analytics_session" ("website_id", "is_bounce") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "analytics_daily_stats" cascade;`);

    this.addSql(`drop table if exists "analytics_event" cascade;`);

    this.addSql(`drop table if exists "analytics_session" cascade;`);
  }

}
