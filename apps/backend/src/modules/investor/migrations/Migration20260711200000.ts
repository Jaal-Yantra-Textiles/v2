import { Migration } from '@mikro-orm/migrations';

// SAFE / convertible funding rounds — #969 follow-up.
// Adds instrument_type + SAFE terms to funding_round and extends round_type to
// allow 'safe', so a round can be published as a SAFE that investors join
// (participating issues a Convertible instead of a Stake).
export class Migration20260711200000 extends Migration {

  async up(): Promise<void> {
    this.addSql(`alter table if exists "funding_round" add column if not exists "instrument_type" text check ("instrument_type" in ('equity', 'safe', 'convertible_note')) not null default 'equity';`);
    this.addSql(`alter table if exists "funding_round" add column if not exists "valuation_cap" numeric null;`);
    this.addSql(`alter table if exists "funding_round" add column if not exists "raw_valuation_cap" jsonb null;`);
    this.addSql(`alter table if exists "funding_round" add column if not exists "discount_rate" real null;`);
    this.addSql(`alter table if exists "funding_round" add column if not exists "safe_type" text check ("safe_type" in ('post_money', 'pre_money')) null;`);

    this.addSql(`alter table if exists "funding_round" drop constraint if exists "funding_round_round_type_check";`);
    this.addSql(`alter table if exists "funding_round" add constraint "funding_round_round_type_check" check ("round_type" in ('pre_seed', 'seed', 'series_a', 'series_b', 'series_c', 'series_d_plus', 'bridge', 'debt', 'grant', 'safe'));`);
  }

  async down(): Promise<void> {
    this.addSql(`alter table if exists "funding_round" drop constraint if exists "funding_round_round_type_check";`);
    this.addSql(`alter table if exists "funding_round" add constraint "funding_round_round_type_check" check ("round_type" in ('pre_seed', 'seed', 'series_a', 'series_b', 'series_c', 'series_d_plus', 'bridge', 'debt', 'grant'));`);
    this.addSql(`alter table if exists "funding_round" drop column if exists "safe_type";`);
    this.addSql(`alter table if exists "funding_round" drop column if exists "discount_rate";`);
    this.addSql(`alter table if exists "funding_round" drop column if exists "valuation_cap";`);
    this.addSql(`alter table if exists "funding_round" drop column if exists "instrument_type";`);
  }

}
