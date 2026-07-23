import { Migration } from '@mikro-orm/migrations';

// Convertible instruments (SAFE / convertible note) — #969 follow-up.
// Creates the `convertible` table, adds the payment → convertible FK column,
// and extends the investor_payment.payment_type check to include 'convertible'.
export class Migration20260711180000 extends Migration {

  async up(): Promise<void> {
    this.addSql(`create table if not exists "convertible" (
      "id" text not null,
      "investor_id" text not null,
      "cap_table_id" text not null,
      "funding_round_id" text null,
      "instrument_type" text check ("instrument_type" in ('safe', 'convertible_note')) not null default 'safe',
      "principal_amount" numeric not null,
      "raw_principal_amount" jsonb not null,
      "currency_code" text null,
      "valuation_cap" numeric null,
      "raw_valuation_cap" jsonb null,
      "discount_rate" real null,
      "safe_type" text check ("safe_type" in ('post_money', 'pre_money')) not null default 'post_money',
      "mfn" boolean not null default false,
      "pro_rata" boolean not null default false,
      "interest_rate" real null,
      "maturity_date" timestamptz null,
      "investment_date" timestamptz null,
      "status" text check ("status" in ('outstanding', 'converted', 'redeemed', 'cancelled', 'expired')) not null default 'outstanding',
      "converted_stake_id" text null,
      "conversion_date" timestamptz null,
      "conversion_price_per_share" numeric null,
      "raw_conversion_price_per_share" jsonb null,
      "conversion_shares" numeric null,
      "raw_conversion_shares" jsonb null,
      "notes" text null,
      "metadata" jsonb null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "convertible_pkey" primary key ("id")
    );`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_convertible_investor_id" ON "convertible" ("investor_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_convertible_cap_table_id" ON "convertible" ("cap_table_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_convertible_deleted_at" ON "convertible" ("deleted_at") WHERE deleted_at IS NULL;`);

    // payment → convertible link (nullable, mirrors the stake/call_for_shares FKs).
    this.addSql(`alter table if exists "investor_payment" add column if not exists "convertible_id" text null;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_investor_payment_convertible_id" ON "investor_payment" ("convertible_id") WHERE deleted_at IS NULL;`);

    // Extend payment_type check to include 'convertible'.
    this.addSql(`alter table if exists "investor_payment" drop constraint if exists "investor_payment_payment_type_check";`);
    this.addSql(`alter table if exists "investor_payment" add constraint "investor_payment_payment_type_check" check ("payment_type" in ('subscription', 'capital_call', 'top_up', 'transfer_fee', 'convertible', 'other'));`);
  }

  async down(): Promise<void> {
    this.addSql(`alter table if exists "investor_payment" drop constraint if exists "investor_payment_payment_type_check";`);
    this.addSql(`alter table if exists "investor_payment" add constraint "investor_payment_payment_type_check" check ("payment_type" in ('subscription', 'capital_call', 'top_up', 'transfer_fee', 'other'));`);
    this.addSql(`alter table if exists "investor_payment" drop column if exists "convertible_id";`);
    this.addSql(`drop table if exists "convertible" cascade;`);
  }

}
