import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20251206102824 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "ad_account" ("id" text not null, "meta_account_id" text not null, "name" text not null, "currency" text not null default 'USD', "timezone" text null, "business_name" text null, "business_id" text null, "status" text check ("status" in ('active', 'disabled', 'pending', 'error')) not null default 'active', "account_status" integer null, "disable_reason" text null, "amount_spent" numeric not null default 0, "spend_cap" numeric null, "balance" numeric null, "min_daily_budget" numeric null, "last_synced_at" timestamptz null, "sync_status" text check ("sync_status" in ('synced', 'syncing', 'error', 'pending')) not null default 'pending', "sync_error" text null, "platform_id" text not null, "metadata" jsonb null, "raw_amount_spent" jsonb not null default '{"value":"0","precision":20}', "raw_spend_cap" jsonb null, "raw_balance" jsonb null, "raw_min_daily_budget" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "ad_account_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ad_account_platform_id" ON "ad_account" ("platform_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ad_account_deleted_at" ON "ad_account" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "lead_form" ("id" text not null, "meta_form_id" text not null, "name" text not null, "status" text check ("status" in ('ACTIVE', 'ARCHIVED', 'DELETED')) not null default 'ACTIVE', "page_id" text not null, "page_name" text null, "locale" text null, "questions" jsonb null, "privacy_policy_url" text null, "thank_you_page_url" text null, "context_card" jsonb null, "follow_up_action_url" text null, "leads_count" integer not null default 0, "last_synced_at" timestamptz null, "ad_account_id" text not null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "lead_form_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_lead_form_ad_account_id" ON "lead_form" ("ad_account_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_lead_form_deleted_at" ON "lead_form" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "lead" ("id" text not null, "meta_lead_id" text not null, "email" text null, "phone" text null, "full_name" text null, "first_name" text null, "last_name" text null, "company_name" text null, "job_title" text null, "city" text null, "state" text null, "country" text null, "zip_code" text null, "field_data" jsonb null, "ad_id" text null, "ad_name" text null, "adset_id" text null, "adset_name" text null, "campaign_id" text null, "campaign_name" text null, "form_id" text null, "form_name" text null, "page_id" text null, "page_name" text null, "source_platform" text null, "created_time" timestamptz not null, "status" text check ("status" in ('new', 'contacted', 'qualified', 'unqualified', 'converted', 'lost', 'archived')) not null default 'new', "notes" text null, "assigned_to" text null, "assigned_at" timestamptz null, "contacted_at" timestamptz null, "qualified_at" timestamptz null, "converted_at" timestamptz null, "estimated_value" numeric null, "actual_value" numeric null, "utm_source" text null, "utm_medium" text null, "utm_campaign" text null, "person_id" text null, "external_id" text null, "external_system" text null, "synced_to_external_at" timestamptz null, "lead_form_id" text not null, "platform_id" text not null, "metadata" jsonb null, "raw_estimated_value" jsonb null, "raw_actual_value" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "lead_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_lead_lead_form_id" ON "lead" ("lead_form_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_lead_platform_id" ON "lead" ("platform_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_lead_deleted_at" ON "lead" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "ad_campaign" ("id" text not null, "meta_campaign_id" text not null, "name" text not null, "objective" text check ("objective" in ('OUTCOME_AWARENESS', 'OUTCOME_ENGAGEMENT', 'OUTCOME_LEADS', 'OUTCOME_SALES', 'OUTCOME_TRAFFIC', 'OUTCOME_APP_PROMOTION', 'LINK_CLICKS', 'CONVERSIONS', 'LEAD_GENERATION', 'MESSAGES', 'VIDEO_VIEWS', 'BRAND_AWARENESS', 'REACH', 'POST_ENGAGEMENT', 'PAGE_LIKES', 'OTHER')) not null default 'OTHER', "status" text check ("status" in ('ACTIVE', 'PAUSED', 'DELETED', 'ARCHIVED')) not null default 'PAUSED', "effective_status" text null, "configured_status" text null, "buying_type" text check ("buying_type" in ('AUCTION', 'RESERVED')) not null default 'AUCTION', "daily_budget" numeric null, "lifetime_budget" numeric null, "budget_remaining" numeric null, "special_ad_categories" jsonb null, "start_time" timestamptz null, "stop_time" timestamptz null, "impressions" numeric not null default 0, "clicks" numeric not null default 0, "spend" numeric not null default 0, "reach" numeric not null default 0, "leads" numeric not null default 0, "conversions" numeric not null default 0, "cpc" real null, "cpm" real null, "ctr" real null, "cost_per_lead" real null, "last_synced_at" timestamptz null, "ad_account_id" text not null, "metadata" jsonb null, "raw_daily_budget" jsonb null, "raw_lifetime_budget" jsonb null, "raw_budget_remaining" jsonb null, "raw_impressions" jsonb not null default '{"value":"0","precision":20}', "raw_clicks" jsonb not null default '{"value":"0","precision":20}', "raw_spend" jsonb not null default '{"value":"0","precision":20}', "raw_reach" jsonb not null default '{"value":"0","precision":20}', "raw_leads" jsonb not null default '{"value":"0","precision":20}', "raw_conversions" jsonb not null default '{"value":"0","precision":20}', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "ad_campaign_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ad_campaign_ad_account_id" ON "ad_campaign" ("ad_account_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ad_campaign_deleted_at" ON "ad_campaign" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "ad_set" ("id" text not null, "meta_adset_id" text not null, "name" text not null, "status" text check ("status" in ('ACTIVE', 'PAUSED', 'DELETED', 'ARCHIVED')) not null default 'PAUSED', "effective_status" text null, "configured_status" text null, "daily_budget" numeric null, "lifetime_budget" numeric null, "budget_remaining" numeric null, "bid_amount" numeric null, "bid_strategy" text null, "billing_event" text check ("billing_event" in ('IMPRESSIONS', 'LINK_CLICKS', 'APP_INSTALLS', 'PAGE_LIKES', 'POST_ENGAGEMENT', 'VIDEO_VIEWS', 'THRUPLAY', 'OTHER')) not null default 'IMPRESSIONS', "optimization_goal" text null, "targeting" jsonb null, "placements" jsonb null, "start_time" timestamptz null, "end_time" timestamptz null, "impressions" numeric not null default 0, "clicks" numeric not null default 0, "spend" numeric not null default 0, "reach" numeric not null default 0, "leads" numeric not null default 0, "cpc" real null, "cpm" real null, "ctr" real null, "cost_per_lead" real null, "last_synced_at" timestamptz null, "campaign_id" text not null, "metadata" jsonb null, "raw_daily_budget" jsonb null, "raw_lifetime_budget" jsonb null, "raw_budget_remaining" jsonb null, "raw_bid_amount" jsonb null, "raw_impressions" jsonb not null default '{"value":"0","precision":20}', "raw_clicks" jsonb not null default '{"value":"0","precision":20}', "raw_spend" jsonb not null default '{"value":"0","precision":20}', "raw_reach" jsonb not null default '{"value":"0","precision":20}', "raw_leads" jsonb not null default '{"value":"0","precision":20}', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "ad_set_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ad_set_campaign_id" ON "ad_set" ("campaign_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ad_set_deleted_at" ON "ad_set" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "ad" ("id" text not null, "meta_ad_id" text not null, "name" text not null, "status" text check ("status" in ('ACTIVE', 'PAUSED', 'DELETED', 'ARCHIVED')) not null default 'PAUSED', "effective_status" text null, "configured_status" text null, "creative_id" text null, "creative" jsonb null, "preview_url" text null, "headline" text null, "body" text null, "call_to_action" text null, "link_url" text null, "image_url" text null, "video_url" text null, "impressions" numeric not null default 0, "clicks" numeric not null default 0, "spend" numeric not null default 0, "reach" numeric not null default 0, "leads" numeric not null default 0, "conversions" numeric not null default 0, "cpc" real null, "cpm" real null, "ctr" real null, "cost_per_lead" real null, "likes" numeric not null default 0, "comments" numeric not null default 0, "shares" numeric not null default 0, "last_synced_at" timestamptz null, "ad_set_id" text not null, "metadata" jsonb null, "raw_impressions" jsonb not null default '{"value":"0","precision":20}', "raw_clicks" jsonb not null default '{"value":"0","precision":20}', "raw_spend" jsonb not null default '{"value":"0","precision":20}', "raw_reach" jsonb not null default '{"value":"0","precision":20}', "raw_leads" jsonb not null default '{"value":"0","precision":20}', "raw_conversions" jsonb not null default '{"value":"0","precision":20}', "raw_likes" jsonb not null default '{"value":"0","precision":20}', "raw_comments" jsonb not null default '{"value":"0","precision":20}', "raw_shares" jsonb not null default '{"value":"0","precision":20}', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "ad_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ad_ad_set_id" ON "ad" ("ad_set_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ad_deleted_at" ON "ad" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "ad_account" add constraint "ad_account_platform_id_foreign" foreign key ("platform_id") references "social_platform" ("id") on update cascade;`);

    this.addSql(`alter table if exists "lead_form" add constraint "lead_form_ad_account_id_foreign" foreign key ("ad_account_id") references "ad_account" ("id") on update cascade;`);

    this.addSql(`alter table if exists "lead" add constraint "lead_lead_form_id_foreign" foreign key ("lead_form_id") references "lead_form" ("id") on update cascade;`);
    this.addSql(`alter table if exists "lead" add constraint "lead_platform_id_foreign" foreign key ("platform_id") references "social_platform" ("id") on update cascade;`);

    this.addSql(`alter table if exists "ad_campaign" add constraint "ad_campaign_ad_account_id_foreign" foreign key ("ad_account_id") references "ad_account" ("id") on update cascade;`);

    this.addSql(`alter table if exists "ad_set" add constraint "ad_set_campaign_id_foreign" foreign key ("campaign_id") references "ad_campaign" ("id") on update cascade;`);

    this.addSql(`alter table if exists "ad" add constraint "ad_ad_set_id_foreign" foreign key ("ad_set_id") references "ad_set" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "lead_form" drop constraint if exists "lead_form_ad_account_id_foreign";`);

    this.addSql(`alter table if exists "ad_campaign" drop constraint if exists "ad_campaign_ad_account_id_foreign";`);

    this.addSql(`alter table if exists "lead" drop constraint if exists "lead_lead_form_id_foreign";`);

    this.addSql(`alter table if exists "ad_set" drop constraint if exists "ad_set_campaign_id_foreign";`);

    this.addSql(`alter table if exists "ad" drop constraint if exists "ad_ad_set_id_foreign";`);

    this.addSql(`drop table if exists "ad_account" cascade;`);

    this.addSql(`drop table if exists "lead_form" cascade;`);

    this.addSql(`drop table if exists "lead" cascade;`);

    this.addSql(`drop table if exists "ad_campaign" cascade;`);

    this.addSql(`drop table if exists "ad_set" cascade;`);

    this.addSql(`drop table if exists "ad" cascade;`);
  }

}
