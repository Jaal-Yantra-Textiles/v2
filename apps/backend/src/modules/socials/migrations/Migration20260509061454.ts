import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260509061454 extends Migration {

  override async up(): Promise<void> {
    // GoogleAdsCustomer — one row per Google Ads CID we've synced
    this.addSql(`create table if not exists "google_ads_customer" ("id" text not null, "customer_id" text not null, "resource_name" text null, "descriptive_name" text null, "currency_code" text null, "time_zone" text null, "is_manager" boolean not null default false, "is_test_account" boolean not null default false, "last_synced_at" timestamptz null, "sync_status" text check ("sync_status" in ('synced', 'syncing', 'error', 'pending')) not null default 'pending', "sync_error" text null, "binding_id" text null, "platform_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "google_ads_customer_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_google_ads_customer_platform_id" ON "google_ads_customer" ("platform_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_google_ads_customer_deleted_at" ON "google_ads_customer" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_google_ads_customer_cid" ON "google_ads_customer" ("customer_id") WHERE deleted_at IS NULL;`);

    // GoogleAdsCampaign — campaigns under a customer
    this.addSql(`create table if not exists "google_ads_campaign" ("id" text not null, "campaign_id" text not null, "resource_name" text null, "name" text not null, "status" text check ("status" in ('UNSPECIFIED', 'UNKNOWN', 'ENABLED', 'PAUSED', 'REMOVED')) not null default 'UNSPECIFIED', "serving_status" text null, "advertising_channel_type" text check ("advertising_channel_type" in ('UNSPECIFIED', 'UNKNOWN', 'SEARCH', 'DISPLAY', 'SHOPPING', 'HOTEL', 'VIDEO', 'MULTI_CHANNEL', 'LOCAL', 'SMART', 'PERFORMANCE_MAX', 'LOCAL_SERVICES', 'TRAVEL', 'DEMAND_GEN')) not null default 'UNSPECIFIED', "bidding_strategy_type" text null, "start_date" text null, "end_date" text null, "budget_amount_micros" numeric null, "impressions" numeric not null default 0, "clicks" numeric not null default 0, "conversions" numeric not null default 0, "cost_micros" numeric not null default 0, "last_synced_at" timestamptz null, "customer_id" text not null, "metadata" jsonb null, "raw_budget_amount_micros" jsonb null, "raw_impressions" jsonb not null default '{"value":"0","precision":20}', "raw_clicks" jsonb not null default '{"value":"0","precision":20}', "raw_conversions" jsonb not null default '{"value":"0","precision":20}', "raw_cost_micros" jsonb not null default '{"value":"0","precision":20}', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "google_ads_campaign_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_google_ads_campaign_customer_id" ON "google_ads_campaign" ("customer_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_google_ads_campaign_deleted_at" ON "google_ads_campaign" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_google_ads_campaign_id" ON "google_ads_campaign" ("campaign_id") WHERE deleted_at IS NULL;`);

    // GoogleAdsAdGroup — ad groups under a campaign
    this.addSql(`create table if not exists "google_ads_ad_group" ("id" text not null, "ad_group_id" text not null, "resource_name" text null, "name" text not null, "status" text check ("status" in ('UNSPECIFIED', 'UNKNOWN', 'ENABLED', 'PAUSED', 'REMOVED')) not null default 'UNSPECIFIED', "type" text null, "impressions" numeric not null default 0, "clicks" numeric not null default 0, "conversions" numeric not null default 0, "cost_micros" numeric not null default 0, "last_synced_at" timestamptz null, "campaign_id" text not null, "metadata" jsonb null, "raw_impressions" jsonb not null default '{"value":"0","precision":20}', "raw_clicks" jsonb not null default '{"value":"0","precision":20}', "raw_conversions" jsonb not null default '{"value":"0","precision":20}', "raw_cost_micros" jsonb not null default '{"value":"0","precision":20}', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "google_ads_ad_group_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_google_ads_ad_group_campaign_id" ON "google_ads_ad_group" ("campaign_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_google_ads_ad_group_deleted_at" ON "google_ads_ad_group" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_google_ads_ad_group_id" ON "google_ads_ad_group" ("ad_group_id") WHERE deleted_at IS NULL;`);

    // FK chain: campaign → customer → social_platform; ad_group → campaign
    this.addSql(`alter table if exists "google_ads_customer" add constraint "google_ads_customer_platform_id_foreign" foreign key ("platform_id") references "social_platform" ("id") on update cascade;`);
    this.addSql(`alter table if exists "google_ads_campaign" add constraint "google_ads_campaign_customer_id_foreign" foreign key ("customer_id") references "google_ads_customer" ("id") on update cascade;`);
    this.addSql(`alter table if exists "google_ads_ad_group" add constraint "google_ads_ad_group_campaign_id_foreign" foreign key ("campaign_id") references "google_ads_campaign" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "google_ads_ad_group" cascade;`);
    this.addSql(`drop table if exists "google_ads_campaign" cascade;`);
    this.addSql(`drop table if exists "google_ads_customer" cascade;`);
  }

}
