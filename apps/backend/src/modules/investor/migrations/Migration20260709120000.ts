import { Migration } from '@mikro-orm/migrations';

export class Migration20260709120000 extends Migration {

  async up(): Promise<void> {
    // ── investor ──
    this.addSql('create table if not exists "investor" ("id" text not null, "name" text not null, "handle" text not null, "logo" text null, "status" text check ("status" in (\'active\', \'inactive\', \'pending\')) not null default \'pending\', "is_verified" boolean not null default false, "workspace_type" text check ("workspace_type" in (\'investor\')) not null default \'investor\', "email" text not null, "phone" text null, "legal_name" text null, "tax_id" text null, "tax_id_type" text null, "country_code" text null, "currency_code" text null, "investor_type" text check ("investor_type" in (\'individual\', \'entity\', \'fund\')) not null default \'individual\', "wallet_address" text null, "bank_account_ref" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "investor_pkey" primary key ("id"));');
    this.addSql('CREATE UNIQUE INDEX IF NOT EXISTS "IDX_investor_handle_unique" ON "investor" (handle) WHERE deleted_at IS NULL;');
    this.addSql('CREATE UNIQUE INDEX IF NOT EXISTS "IDX_investor_email_unique" ON "investor" (email) WHERE deleted_at IS NULL;');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_investor_deleted_at" ON "investor" (deleted_at) WHERE deleted_at IS NULL;');

    // ── investor_admin ──
    this.addSql('create table if not exists "investor_admin" ("id" text not null, "first_name" text not null, "last_name" text not null, "email" text not null, "phone" text null, "preferred_language" text null, "password_hash" text null, "is_active" boolean not null default true, "last_login" timestamptz null, "investor_id" text not null, "role" text check ("role" in (\'owner\', \'admin\', \'viewer\')) not null default \'admin\', "permissions" jsonb null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "investor_admin_pkey" primary key ("id"));');
    this.addSql('CREATE UNIQUE INDEX IF NOT EXISTS "IDX_investor_admin_email_unique" ON "investor_admin" (email) WHERE deleted_at IS NULL;');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_investor_admin_investor_id" ON "investor_admin" (investor_id) WHERE deleted_at IS NULL;');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_investor_admin_deleted_at" ON "investor_admin" (deleted_at) WHERE deleted_at IS NULL;');
    this.addSql('alter table if exists "investor_admin" add constraint "investor_admin_investor_id_foreign" foreign key ("investor_id") references "investor" ("id") on update cascade;');

    // ── cap_table ──
    this.addSql('create table if not exists "cap_table" ("id" text not null, "company_id" text not null, "name" text not null, "status" text check ("status" in (\'draft\', \'active\', \'archived\')) not null default \'draft\', "total_shares_authorized" numeric null, "raw_total_shares_authorized" jsonb null, "total_shares_issued" numeric null, "raw_total_shares_issued" jsonb null, "total_shares_outstanding" numeric null, "raw_total_shares_outstanding" jsonb null, "fully_diluted_shares" numeric null, "raw_fully_diluted_shares" jsonb null, "pre_money_valuation" numeric null, "raw_pre_money_valuation" jsonb null, "post_money_valuation" numeric null, "raw_post_money_valuation" jsonb null, "currency_code" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "cap_table_pkey" primary key ("id"));');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_cap_table_company_id" ON "cap_table" (company_id) WHERE deleted_at IS NULL;');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_cap_table_deleted_at" ON "cap_table" (deleted_at) WHERE deleted_at IS NULL;');

    // ── share_class ──
    this.addSql('create table if not exists "share_class" ("id" text not null, "cap_table_id" text not null, "name" text not null, "class_type" text check ("class_type" in (\'common\', \'preferred\', \'convertible_note\', \'safe\', \'warrant\', \'option\')) not null default \'common\', "authorized_shares" numeric null, "raw_authorized_shares" jsonb null, "issued_shares" numeric null, "raw_issued_shares" jsonb null, "outstanding_shares" numeric null, "raw_outstanding_shares" jsonb null, "par_value" numeric null, "raw_par_value" jsonb null, "liquidation_preference" numeric null, "raw_liquidation_preference" jsonb null, "liquidation_preference_type" text check ("liquidation_preference_type" in (\'none\', \'non_participating\', \'participating\')) not null default \'none\', "dividend_rate" numeric null, "conversion_ratio" numeric null, "voting_rights" text check ("voting_rights" in (\'full\', \'limited\', \'none\')) not null default \'full\', "is_convertible" boolean not null default false, "notes" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "share_class_pkey" primary key ("id"));');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_share_class_cap_table_id" ON "share_class" (cap_table_id) WHERE deleted_at IS NULL;');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_share_class_deleted_at" ON "share_class" (deleted_at) WHERE deleted_at IS NULL;');
    this.addSql('alter table if exists "share_class" add constraint "share_class_cap_table_id_foreign" foreign key ("cap_table_id") references "cap_table" ("id") on update cascade;');

    // ── funding_round ──
    this.addSql('create table if not exists "funding_round" ("id" text not null, "cap_table_id" text not null, "name" text not null, "round_type" text check ("round_type" in (\'pre_seed\', \'seed\', \'series_a\', \'series_b\', \'series_c\', \'series_d_plus\', \'bridge\', \'debt\', \'grant\')) not null default \'seed\', "status" text check ("status" in (\'planned\', \'open\', \'closing\', \'closed\', \'cancelled\')) not null default \'planned\', "target_amount" numeric null, "raw_target_amount" jsonb null, "raised_amount" numeric null, "raw_raised_amount" jsonb null, "pre_money_valuation" numeric null, "raw_pre_money_valuation" jsonb null, "post_money_valuation" numeric null, "raw_post_money_valuation" jsonb null, "price_per_share" numeric null, "raw_price_per_share" jsonb null, "shares_offered" numeric null, "raw_shares_offered" jsonb null, "open_date" timestamptz null, "close_date" timestamptz null, "lead_investor" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "funding_round_pkey" primary key ("id"));');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_funding_round_cap_table_id" ON "funding_round" (cap_table_id) WHERE deleted_at IS NULL;');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_funding_round_deleted_at" ON "funding_round" (deleted_at) WHERE deleted_at IS NULL;');
    this.addSql('alter table if exists "funding_round" add constraint "funding_round_cap_table_id_foreign" foreign key ("cap_table_id") references "cap_table" ("id") on update cascade;');

    // ── stake ──
    this.addSql('create table if not exists "stake" ("id" text not null, "investor_id" text not null, "cap_table_id" text not null, "share_class_id" text null, "funding_round_id" text null, "number_of_shares" numeric not null, "raw_number_of_shares" jsonb not null, "share_price" numeric null, "raw_share_price" jsonb null, "total_invested" numeric null, "raw_total_invested" jsonb null, "ownership_percentage" numeric null, "vesting_start_date" timestamptz null, "vesting_schedule" text null, "vested_shares" numeric null, "raw_vested_shares" jsonb null, "certificate_number" text null, "issue_date" timestamptz null, "transfer_status" text check ("transfer_status" in (\'held\', \'transferring\', \'transferred\', \'cancelled\')) not null default \'held\', "status" text check ("status" in (\'active\', \'fully_paid\', \'partially_paid\', \'unpaid\', \'cancelled\')) not null default \'unpaid\', "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "stake_pkey" primary key ("id"));');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_stake_investor_id" ON "stake" (investor_id) WHERE deleted_at IS NULL;');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_stake_cap_table_id" ON "stake" (cap_table_id) WHERE deleted_at IS NULL;');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_stake_share_class_id" ON "stake" (share_class_id) WHERE deleted_at IS NULL;');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_stake_funding_round_id" ON "stake" (funding_round_id) WHERE deleted_at IS NULL;');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_stake_deleted_at" ON "stake" (deleted_at) WHERE deleted_at IS NULL;');
    this.addSql('alter table if exists "stake" add constraint "stake_investor_id_foreign" foreign key ("investor_id") references "investor" ("id") on update cascade;');
    this.addSql('alter table if exists "stake" add constraint "stake_cap_table_id_foreign" foreign key ("cap_table_id") references "cap_table" ("id") on update cascade;');
    this.addSql('alter table if exists "stake" add constraint "stake_share_class_id_foreign" foreign key ("share_class_id") references "share_class" ("id") on update cascade on delete set null;');
    this.addSql('alter table if exists "stake" add constraint "stake_funding_round_id_foreign" foreign key ("funding_round_id") references "funding_round" ("id") on update cascade on delete set null;');

    // ── investor_pipeline ──
    this.addSql('create table if not exists "investor_pipeline" ("id" text not null, "investor_id" text not null, "company_id" text not null, "stage" text check ("stage" in (\'lead\', \'contacted\', \'interested\', \'due_diligence\', \'term_sheet\', \'committed\', \'closed\', \'passed\')) not null default \'lead\', "status" text check ("status" in (\'active\', \'won\', \'lost\', \'on_hold\')) not null default \'active\', "target_amount" numeric null, "raw_target_amount" jsonb null, "committed_amount" numeric null, "raw_committed_amount" jsonb null, "source" text null, "assigned_to" text null, "next_action" text null, "next_action_date" timestamptz null, "notes" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "investor_pipeline_pkey" primary key ("id"));');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_investor_pipeline_investor_id" ON "investor_pipeline" (investor_id) WHERE deleted_at IS NULL;');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_investor_pipeline_deleted_at" ON "investor_pipeline" (deleted_at) WHERE deleted_at IS NULL;');
    this.addSql('alter table if exists "investor_pipeline" add constraint "investor_pipeline_investor_id_foreign" foreign key ("investor_id") references "investor" ("id") on update cascade;');

    // ── call_for_shares ──
    this.addSql('create table if not exists "call_for_shares" ("id" text not null, "cap_table_id" text not null, "name" text not null, "call_type" text check ("call_type" in (\'rights_issue\', \'follow_on\', \'capital_call\', \'top_up\')) not null default \'rights_issue\', "status" text check ("status" in (\'draft\', \'announced\', \'open\', \'closing\', \'closed\', \'cancelled\')) not null default \'draft\', "shares_offered" numeric null, "raw_shares_offered" jsonb null, "price_per_share" numeric null, "raw_price_per_share" jsonb null, "target_amount" numeric null, "raw_target_amount" jsonb null, "raised_amount" numeric null, "raw_raised_amount" jsonb null, "open_date" timestamptz null, "close_date" timestamptz null, "record_date" timestamptz null, "ratio" text null, "terms" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "call_for_shares_pkey" primary key ("id"));');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_call_for_shares_cap_table_id" ON "call_for_shares" (cap_table_id) WHERE deleted_at IS NULL;');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_call_for_shares_deleted_at" ON "call_for_shares" (deleted_at) WHERE deleted_at IS NULL;');
    this.addSql('alter table if exists "call_for_shares" add constraint "call_for_shares_cap_table_id_foreign" foreign key ("cap_table_id") references "cap_table" ("id") on update cascade;');

    // ── investor_payment ──
    this.addSql('create table if not exists "investor_payment" ("id" text not null, "stake_id" text null, "call_for_shares_id" text null, "investor_id" text not null, "company_id" text not null, "amount" numeric not null, "raw_amount" jsonb not null, "currency_code" text null, "payment_type" text check ("payment_type" in (\'subscription\', \'capital_call\', \'top_up\', \'transfer_fee\', \'other\')) not null default \'subscription\', "status" text check ("status" in (\'pending\', \'in_progress\', \'completed\', \'failed\', \'refunded\', \'cancelled\')) not null default \'pending\', "method" text check ("method" in (\'bank_transfer\', \'card\', \'upi\', \'wallet\', \'cheque\', \'other\')) null, "reference_number" text null, "transaction_id" text null, "due_date" timestamptz null, "paid_date" timestamptz null, "notes" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "investor_payment_pkey" primary key ("id"));');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_investor_payment_stake_id" ON "investor_payment" (stake_id) WHERE deleted_at IS NULL;');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_investor_payment_call_for_shares_id" ON "investor_payment" (call_for_shares_id) WHERE deleted_at IS NULL;');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_investor_payment_investor_id" ON "investor_payment" (investor_id) WHERE deleted_at IS NULL;');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_investor_payment_deleted_at" ON "investor_payment" (deleted_at) WHERE deleted_at IS NULL;');
    this.addSql('alter table if exists "investor_payment" add constraint "investor_payment_stake_id_foreign" foreign key ("stake_id") references "stake" ("id") on update cascade on delete set null;');
    this.addSql('alter table if exists "investor_payment" add constraint "investor_payment_call_for_shares_id_foreign" foreign key ("call_for_shares_id") references "call_for_shares" ("id") on update cascade on delete set null;');

    // ── investor_document ──
    this.addSql('create table if not exists "investor_document" ("id" text not null, "cap_table_id" text null, "call_for_shares_id" text null, "investor_id" text null, "company_id" text not null, "title" text not null, "description" text null, "document_type" text check ("document_type" in (\'share_certificate\', \'subscription_agreement\', \'term_sheet\', \'sha\', \'financial_statement\', \'pitch_deck\', \'kyc\', \'legal\', \'other\')) not null default \'other\', "file_key" text not null, "file_url" text null, "file_name" text null, "file_size" numeric null, "mime_type" text null, "visibility" text check ("visibility" in (\'private\', \'investor\', \'public\')) not null default \'investor\', "uploaded_by" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "investor_document_pkey" primary key ("id"));');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_investor_document_cap_table_id" ON "investor_document" (cap_table_id) WHERE deleted_at IS NULL;');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_investor_document_call_for_shares_id" ON "investor_document" (call_for_shares_id) WHERE deleted_at IS NULL;');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_investor_document_deleted_at" ON "investor_document" (deleted_at) WHERE deleted_at IS NULL;');
    this.addSql('alter table if exists "investor_document" add constraint "investor_document_cap_table_id_foreign" foreign key ("cap_table_id") references "cap_table" ("id") on update cascade on delete set null;');
    this.addSql('alter table if exists "investor_document" add constraint "investor_document_call_for_shares_id_foreign" foreign key ("call_for_shares_id") references "call_for_shares" ("id") on update cascade on delete set null;');

    // ── alter companies table ──
    this.addSql('alter table if exists "companies" add column if not exists "cap_table_id" text null;');
    this.addSql('alter table if exists "companies" add column if not exists "investor_dashboard_enabled" boolean not null default false;');
    this.addSql('alter table if exists "companies" add column if not exists "industry" text null;');
    this.addSql('alter table if exists "companies" add column if not exists "description" text null;');
  }

  async down(): Promise<void> {
    this.addSql('alter table if exists "investor_document" drop constraint if exists "investor_document_cap_table_id_foreign";');
    this.addSql('alter table if exists "investor_document" drop constraint if exists "investor_document_call_for_shares_id_foreign";');
    this.addSql('alter table if exists "investor_payment" drop constraint if exists "investor_payment_stake_id_foreign";');
    this.addSql('alter table if exists "investor_payment" drop constraint if exists "investor_payment_call_for_shares_id_foreign";');
    this.addSql('alter table if exists "stake" drop constraint if exists "stake_investor_id_foreign";');
    this.addSql('alter table if exists "stake" drop constraint if exists "stake_cap_table_id_foreign";');
    this.addSql('alter table if exists "stake" drop constraint if exists "stake_share_class_id_foreign";');
    this.addSql('alter table if exists "stake" drop constraint if exists "stake_funding_round_id_foreign";');
    this.addSql('alter table if exists "investor_pipeline" drop constraint if exists "investor_pipeline_investor_id_foreign";');
    this.addSql('alter table if exists "call_for_shares" drop constraint if exists "call_for_shares_cap_table_id_foreign";');
    this.addSql('alter table if exists "funding_round" drop constraint if exists "funding_round_cap_table_id_foreign";');
    this.addSql('alter table if exists "share_class" drop constraint if exists "share_class_cap_table_id_foreign";');
    this.addSql('alter table if exists "investor_admin" drop constraint if exists "investor_admin_investor_id_foreign";');

    this.addSql('drop table if exists "investor_document" cascade;');
    this.addSql('drop table if exists "investor_payment" cascade;');
    this.addSql('drop table if exists "call_for_shares" cascade;');
    this.addSql('drop table if exists "investor_pipeline" cascade;');
    this.addSql('drop table if exists "stake" cascade;');
    this.addSql('drop table if exists "funding_round" cascade;');
    this.addSql('drop table if exists "share_class" cascade;');
    this.addSql('drop table if exists "cap_table" cascade;');
    this.addSql('drop table if exists "investor_admin" cascade;');
    this.addSql('drop table if exists "investor" cascade;');

    this.addSql('alter table if exists "companies" drop column if exists "cap_table_id";');
    this.addSql('alter table if exists "companies" drop column if exists "investor_dashboard_enabled";');
    this.addSql('alter table if exists "companies" drop column if exists "industry";');
    this.addSql('alter table if exists "companies" drop column if exists "description";');
  }

}
