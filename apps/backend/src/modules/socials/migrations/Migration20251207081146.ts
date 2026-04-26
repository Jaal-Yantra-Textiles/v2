import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20251207081146 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "ad_insights" ("id" text not null, "date_start" timestamptz not null, "date_stop" timestamptz not null, "time_increment" text not null default '1', "level" text check ("level" in ('account', 'campaign', 'adset', 'ad')) not null, "meta_account_id" text null, "meta_campaign_id" text null, "meta_adset_id" text null, "meta_ad_id" text null, "impressions" numeric not null default 0, "reach" numeric not null default 0, "frequency" real null, "clicks" numeric not null default 0, "unique_clicks" numeric null, "ctr" real null, "unique_ctr" real null, "spend" numeric not null default 0, "cpc" real null, "cpm" real null, "cpp" real null, "actions" jsonb null, "conversions" numeric null, "conversion_rate" real null, "cost_per_conversion" real null, "leads" numeric null, "cost_per_lead" real null, "video_views" numeric null, "video_p25_watched" numeric null, "video_p50_watched" numeric null, "video_p75_watched" numeric null, "video_p100_watched" numeric null, "video_avg_time_watched" real null, "post_engagement" numeric null, "post_reactions" numeric null, "post_comments" numeric null, "post_shares" numeric null, "post_saves" numeric null, "quality_ranking" text null, "engagement_rate_ranking" text null, "conversion_rate_ranking" text null, "age" text null, "gender" text null, "country" text null, "region" text null, "platform_position" text null, "publisher_platform" text null, "device_platform" text null, "account_id" text null, "campaign_id" text null, "adset_id" text null, "ad_id" text null, "currency" text null, "raw_data" jsonb null, "synced_at" timestamptz not null, "raw_impressions" jsonb not null default '{"value":"0","precision":20}', "raw_reach" jsonb not null default '{"value":"0","precision":20}', "raw_clicks" jsonb not null default '{"value":"0","precision":20}', "raw_unique_clicks" jsonb null, "raw_spend" jsonb not null default '{"value":"0","precision":20}', "raw_conversions" jsonb null, "raw_leads" jsonb null, "raw_video_views" jsonb null, "raw_video_p25_watched" jsonb null, "raw_video_p50_watched" jsonb null, "raw_video_p75_watched" jsonb null, "raw_video_p100_watched" jsonb null, "raw_post_engagement" jsonb null, "raw_post_reactions" jsonb null, "raw_post_comments" jsonb null, "raw_post_shares" jsonb null, "raw_post_saves" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "ad_insights_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ad_insights_account_id" ON "ad_insights" ("account_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ad_insights_campaign_id" ON "ad_insights" ("campaign_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ad_insights_adset_id" ON "ad_insights" ("adset_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ad_insights_ad_id" ON "ad_insights" ("ad_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ad_insights_deleted_at" ON "ad_insights" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "ad_insights" add constraint "ad_insights_account_id_foreign" foreign key ("account_id") references "ad_account" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table if exists "ad_insights" add constraint "ad_insights_campaign_id_foreign" foreign key ("campaign_id") references "ad_campaign" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table if exists "ad_insights" add constraint "ad_insights_adset_id_foreign" foreign key ("adset_id") references "ad_set" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table if exists "ad_insights" add constraint "ad_insights_ad_id_foreign" foreign key ("ad_id") references "ad" ("id") on update cascade on delete set null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "ad_insights" cascade;`);
  }

}
