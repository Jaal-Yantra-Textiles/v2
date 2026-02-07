import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260121220840 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "abexperiment" ("id" text not null, "name" text not null, "description" text null, "status" text check ("status" in ('draft', 'running', 'paused', 'completed')) not null default 'draft', "experiment_type" text check ("experiment_type" in ('ad_creative', 'landing_page', 'audience', 'budget', 'bidding')) not null default 'ad_creative', "variants" jsonb not null, "target_sample_size" integer null, "confidence_level" real not null default 0.95, "minimum_detectable_effect" real null, "primary_metric" text check ("primary_metric" in ('conversion_rate', 'ctr', 'cpc', 'roas', 'leads', 'revenue')) not null default 'conversion_rate', "results" jsonb null, "is_significant" boolean not null default false, "p_value" real null, "improvement_percent" real null, "started_at" timestamptz null, "ended_at" timestamptz null, "website_id" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "abexperiment_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_abexperiment_deleted_at" ON "abexperiment" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_experiment_status" ON "abexperiment" ("status") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_experiment_website_status" ON "abexperiment" ("website_id", "status") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "budget_forecast" ("id" text not null, "ad_account_id" text null, "ad_campaign_id" text null, "forecast_level" text check ("forecast_level" in ('account', 'campaign')) not null default 'campaign', "forecast_date" timestamptz not null, "generated_at" timestamptz not null, "lookback_days" integer not null default 30, "predicted_spend" numeric null, "predicted_impressions" numeric null, "predicted_clicks" numeric null, "predicted_conversions" numeric null, "predicted_revenue" numeric null, "predicted_roas" real null, "predicted_cpa" real null, "predicted_cpc" real null, "confidence_intervals" jsonb null, "actual_spend" numeric null, "actual_impressions" numeric null, "actual_clicks" numeric null, "actual_conversions" numeric null, "actual_revenue" numeric null, "forecast_error_percent" real null, "is_actual_recorded" boolean not null default false, "metadata" jsonb null, "raw_predicted_spend" jsonb null, "raw_predicted_impressions" jsonb null, "raw_predicted_clicks" jsonb null, "raw_predicted_conversions" jsonb null, "raw_predicted_revenue" jsonb null, "raw_actual_spend" jsonb null, "raw_actual_impressions" jsonb null, "raw_actual_clicks" jsonb null, "raw_actual_conversions" jsonb null, "raw_actual_revenue" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "budget_forecast_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_budget_forecast_deleted_at" ON "budget_forecast" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_forecast_campaign_date" ON "budget_forecast" ("ad_campaign_id", "forecast_date") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_forecast_account_date" ON "budget_forecast" ("ad_account_id", "forecast_date") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_forecast_date" ON "budget_forecast" ("forecast_date") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "campaign_attribution" ("id" text not null, "analytics_session_id" text not null, "visitor_id" text not null, "website_id" text not null, "ad_campaign_id" text null, "ad_set_id" text null, "ad_id" text null, "platform" text check ("platform" in ('meta', 'google', 'generic')) not null default 'meta', "utm_source" text null, "utm_medium" text null, "utm_campaign" text null, "utm_term" text null, "utm_content" text null, "is_resolved" boolean not null default false, "resolution_confidence" real null, "resolution_method" text check ("resolution_method" in ('exact_utm_match', 'fuzzy_name_match', 'manual', 'unresolved')) not null default 'unresolved', "entry_page" text null, "session_pageviews" integer not null default 1, "attributed_at" timestamptz not null, "session_started_at" timestamptz not null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "campaign_attribution_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_campaign_attribution_deleted_at" ON "campaign_attribution" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "idx_attribution_session_unique" ON "campaign_attribution" ("analytics_session_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_attribution_campaign" ON "campaign_attribution" ("ad_campaign_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_attribution_resolved" ON "campaign_attribution" ("is_resolved") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_attribution_website_time" ON "campaign_attribution" ("website_id", "attributed_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_attribution_utm_campaign" ON "campaign_attribution" ("utm_campaign") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "conversion" ("id" text not null, "conversion_type" text check ("conversion_type" in ('lead_form_submission', 'add_to_cart', 'begin_checkout', 'purchase', 'page_engagement', 'scroll_depth', 'time_on_site', 'custom')) not null default 'custom', "conversion_name" text null, "ad_campaign_id" text null, "ad_set_id" text null, "ad_id" text null, "platform" text check ("platform" in ('meta', 'google', 'generic', 'direct')) not null default 'direct', "utm_source" text null, "utm_medium" text null, "utm_campaign" text null, "utm_term" text null, "utm_content" text null, "attribution_model" text check ("attribution_model" in ('last_click', 'first_click', 'linear', 'time_decay')) not null default 'last_click', "attribution_weight" real not null default 1, "conversion_value" numeric null, "currency" text not null default 'INR', "order_id" text null, "analytics_event_id" text null, "analytics_session_id" text null, "lead_id" text null, "person_id" text null, "visitor_id" text not null, "session_id" text null, "website_id" text null, "converted_at" timestamptz not null, "metadata" jsonb null, "raw_conversion_value" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "conversion_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_conversion_deleted_at" ON "conversion" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_conversion_website_time" ON "conversion" ("website_id", "converted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_conversion_campaign" ON "conversion" ("ad_campaign_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_conversion_type_time" ON "conversion" ("conversion_type", "converted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_conversion_person" ON "conversion" ("person_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_conversion_visitor" ON "conversion" ("visitor_id") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "conversion_goal" ("id" text not null, "name" text not null, "description" text null, "goal_type" text check ("goal_type" in ('lead_form', 'purchase', 'add_to_cart', 'page_view', 'time_on_page', 'scroll_depth', 'custom_event')) not null, "conditions" jsonb not null, "default_value" numeric null, "value_from_event" boolean not null default false, "is_active" boolean not null default true, "website_id" text null, "priority" integer not null default 0, "metadata" jsonb null, "raw_default_value" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "conversion_goal_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_conversion_goal_deleted_at" ON "conversion_goal" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_goal_website_active" ON "conversion_goal" ("website_id", "is_active") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_goal_type" ON "conversion_goal" ("goal_type") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "customer_journey" ("id" text not null, "person_id" text null, "visitor_id" text null, "event_type" text check ("event_type" in ('form_submit', 'feedback', 'purchase', 'page_view', 'social_engage', 'lead_capture', 'email_open', 'email_click', 'ad_click', 'support_ticket', 'custom')) not null, "event_name" text null, "event_data" jsonb null, "channel" text check ("channel" in ('web', 'social', 'email', 'sms', 'phone', 'in_person', 'ad')) not null default 'web', "stage" text check ("stage" in ('awareness', 'interest', 'consideration', 'intent', 'conversion', 'retention', 'advocacy')) not null default 'awareness', "source_type" text null, "source_id" text null, "utm_source" text null, "utm_campaign" text null, "ad_campaign_id" text null, "website_id" text null, "page_url" text null, "occurred_at" timestamptz not null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "customer_journey_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_customer_journey_deleted_at" ON "customer_journey" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_journey_person_time" ON "customer_journey" ("person_id", "occurred_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_journey_visitor_time" ON "customer_journey" ("visitor_id", "occurred_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_journey_type_time" ON "customer_journey" ("event_type", "occurred_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_journey_stage" ON "customer_journey" ("stage") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_journey_website_time" ON "customer_journey" ("website_id", "occurred_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "customer_score" ("id" text not null, "person_id" text not null, "score_type" text check ("score_type" in ('nps', 'engagement', 'clv', 'churn_risk', 'satisfaction')) not null, "score_value" real not null, "breakdown" jsonb null, "confidence" real null, "previous_score" real null, "score_change" real null, "trend_direction" text check ("trend_direction" in ('up', 'down', 'stable')) null, "calculated_at" timestamptz not null, "expires_at" timestamptz null, "data_window_days" integer not null default 30, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "customer_score_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_customer_score_deleted_at" ON "customer_score" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "idx_score_person_type_unique" ON "customer_score" ("person_id", "score_type") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_score_type_value" ON "customer_score" ("score_type", "score_value") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_score_type_time" ON "customer_score" ("score_type", "calculated_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "customer_segment" ("id" text not null, "name" text not null, "description" text null, "segment_type" text check ("segment_type" in ('behavioral', 'demographic', 'rfm', 'custom')) not null default 'custom', "criteria" jsonb not null, "customer_count" integer not null default 0, "last_calculated_at" timestamptz null, "is_active" boolean not null default true, "auto_update" boolean not null default true, "color" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "customer_segment_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_customer_segment_deleted_at" ON "customer_segment" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_segment_active" ON "customer_segment" ("is_active") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_segment_type" ON "customer_segment" ("segment_type") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "segment_member" ("id" text not null, "segment_id" text not null, "person_id" text not null, "added_at" timestamptz not null, "added_reason" text check ("added_reason" in ('rule_match', 'manual', 'import')) not null default 'rule_match', "score_at_addition" real null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "segment_member_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_segment_member_segment_id" ON "segment_member" ("segment_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_segment_member_deleted_at" ON "segment_member" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_segment_member_person" ON "segment_member" ("person_id") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "sentiment_analysis" ("id" text not null, "source_type" text check ("source_type" in ('feedback', 'form_response', 'social_mention', 'social_comment', 'review')) not null, "source_id" text not null, "original_text" text null, "text_hash" text null, "sentiment_score" real not null, "sentiment_label" text check ("sentiment_label" in ('very_negative', 'negative', 'neutral', 'positive', 'very_positive', 'mixed')) not null default 'neutral', "confidence" real not null default 1, "keywords" jsonb null, "entities" jsonb null, "topics" jsonb null, "emotions" jsonb null, "model_provider" text not null default 'openai', "model_version" text null, "analyzed_at" timestamptz not null, "processing_time_ms" integer null, "person_id" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "sentiment_analysis_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_sentiment_analysis_deleted_at" ON "sentiment_analysis" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "idx_sentiment_source_unique" ON "sentiment_analysis" ("source_type", "source_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_sentiment_label" ON "sentiment_analysis" ("sentiment_label") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_sentiment_time" ON "sentiment_analysis" ("analyzed_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_sentiment_person" ON "sentiment_analysis" ("person_id") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "segment_member" add constraint "segment_member_segment_id_foreign" foreign key ("segment_id") references "customer_segment" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "segment_member" drop constraint if exists "segment_member_segment_id_foreign";`);

    this.addSql(`drop table if exists "abexperiment" cascade;`);

    this.addSql(`drop table if exists "budget_forecast" cascade;`);

    this.addSql(`drop table if exists "campaign_attribution" cascade;`);

    this.addSql(`drop table if exists "conversion" cascade;`);

    this.addSql(`drop table if exists "conversion_goal" cascade;`);

    this.addSql(`drop table if exists "customer_journey" cascade;`);

    this.addSql(`drop table if exists "customer_score" cascade;`);

    this.addSql(`drop table if exists "customer_segment" cascade;`);

    this.addSql(`drop table if exists "segment_member" cascade;`);

    this.addSql(`drop table if exists "sentiment_analysis" cascade;`);
  }

}
