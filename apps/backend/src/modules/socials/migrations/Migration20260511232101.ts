import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260511232101 extends Migration {

  override async up(): Promise<void> {
    // GoogleAdsAd — individual ads (creatives) under an ad group
    this.addSql(`create table if not exists "google_ads_ad" (
      "id" text not null,
      "ad_id" text not null,
      "resource_name" text null,
      "ad_resource_name" text null,
      "name" text null,
      "status" text check ("status" in ('UNSPECIFIED', 'UNKNOWN', 'ENABLED', 'PAUSED', 'REMOVED')) not null default 'UNSPECIFIED',
      "ad_status" text check ("ad_status" in ('UNSPECIFIED', 'UNKNOWN', 'ENABLED', 'PAUSED', 'REMOVED')) not null default 'UNSPECIFIED',
      "type" text null,
      "display_url" text null,
      "final_urls" jsonb null,
      "final_mobile_urls" jsonb null,
      "headlines" jsonb null,
      "descriptions" jsonb null,
      "image_url" text null,
      "video_id" text null,
      "impressions" numeric not null default 0,
      "clicks" numeric not null default 0,
      "conversions" numeric not null default 0,
      "cost_micros" numeric not null default 0,
      "raw_impressions" jsonb not null default '{"value":"0","precision":20}',
      "raw_clicks" jsonb not null default '{"value":"0","precision":20}',
      "raw_conversions" jsonb not null default '{"value":"0","precision":20}',
      "raw_cost_micros" jsonb not null default '{"value":"0","precision":20}',
      "last_synced_at" timestamptz null,
      "ad_group_id" text not null,
      "metadata" jsonb null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "google_ads_ad_pkey" primary key ("id")
    );`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_google_ads_ad_ad_group_id" ON "google_ads_ad" ("ad_group_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_google_ads_ad_deleted_at" ON "google_ads_ad" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_google_ads_ad_id" ON "google_ads_ad" ("ad_id") WHERE deleted_at IS NULL;`);

    // GoogleAdsInsights — time-series metrics rows; polymorphic-by-nullability
    // on customer_id / campaign_id / ad_group_id / ad_id.
    this.addSql(`create table if not exists "google_ads_insights" (
      "id" text not null,
      "date" text not null,
      "time_increment" text not null default '1',
      "level" text check ("level" in ('customer', 'campaign', 'ad_group', 'ad')) not null,
      "impressions" numeric not null default 0,
      "clicks" numeric not null default 0,
      "ctr" real null,
      "cost_micros" numeric not null default 0,
      "average_cpc_micros" numeric null,
      "average_cpm_micros" numeric null,
      "average_cpv_micros" numeric null,
      "conversions" real not null default 0,
      "conversions_value" real null,
      "all_conversions" real null,
      "all_conversions_value" real null,
      "view_through_conversions" real null,
      "cost_per_conversion_micros" numeric null,
      "video_views" numeric null,
      "video_view_rate" real null,
      "video_quartile_p25_rate" real null,
      "video_quartile_p50_rate" real null,
      "video_quartile_p75_rate" real null,
      "video_quartile_p100_rate" real null,
      "engagements" numeric null,
      "engagement_rate" real null,
      "interactions" numeric null,
      "interaction_rate" real null,
      "search_impression_share" real null,
      "search_top_impression_share" real null,
      "search_absolute_top_impression_share" real null,
      "device" text null,
      "network" text null,
      "geo_country_code" text null,
      "geo_region" text null,
      "customer_id" text null,
      "campaign_id" text null,
      "ad_group_id" text null,
      "ad_id" text null,
      "currency_code" text null,
      "raw_data" jsonb null,
      "synced_at" timestamptz not null,
      "raw_impressions" jsonb not null default '{"value":"0","precision":20}',
      "raw_clicks" jsonb not null default '{"value":"0","precision":20}',
      "raw_cost_micros" jsonb not null default '{"value":"0","precision":20}',
      "raw_average_cpc_micros" jsonb null,
      "raw_average_cpm_micros" jsonb null,
      "raw_average_cpv_micros" jsonb null,
      "raw_cost_per_conversion_micros" jsonb null,
      "raw_video_views" jsonb null,
      "raw_engagements" jsonb null,
      "raw_interactions" jsonb null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "google_ads_insights_pkey" primary key ("id")
    );`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_google_ads_insights_customer_id" ON "google_ads_insights" ("customer_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_google_ads_insights_campaign_id" ON "google_ads_insights" ("campaign_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_google_ads_insights_ad_group_id" ON "google_ads_insights" ("ad_group_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_google_ads_insights_ad_id" ON "google_ads_insights" ("ad_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_google_ads_insights_deleted_at" ON "google_ads_insights" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_google_ads_insights_level_date" ON "google_ads_insights" ("level", "date") WHERE deleted_at IS NULL;`);

    // FK chain
    this.addSql(`alter table if exists "google_ads_ad" add constraint "google_ads_ad_ad_group_id_foreign" foreign key ("ad_group_id") references "google_ads_ad_group" ("id") on update cascade;`);
    this.addSql(`alter table if exists "google_ads_insights" add constraint "google_ads_insights_customer_id_foreign" foreign key ("customer_id") references "google_ads_customer" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table if exists "google_ads_insights" add constraint "google_ads_insights_campaign_id_foreign" foreign key ("campaign_id") references "google_ads_campaign" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table if exists "google_ads_insights" add constraint "google_ads_insights_ad_group_id_foreign" foreign key ("ad_group_id") references "google_ads_ad_group" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table if exists "google_ads_insights" add constraint "google_ads_insights_ad_id_foreign" foreign key ("ad_id") references "google_ads_ad" ("id") on update cascade on delete set null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "google_ads_insights" cascade;`);
    this.addSql(`drop table if exists "google_ads_ad" cascade;`);
  }

}
