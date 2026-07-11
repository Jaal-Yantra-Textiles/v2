import { Migration } from '@mikro-orm/migrations';

// CCPS (Compulsorily Convertible Preference Shares — the Indian iSAFE legal
// wrapper) — #969 follow-up.
//
// Rides the existing `convertible` instrument: same cap/discount conversion
// economics as a SAFE, but shares are allotted up front (`num_shares`) and the
// holder carries preference terms. This migration:
//  - adds the CCPS columns to `convertible` (incl. the raw_ jsonb the bignumber
//    `num_shares` needs — see the raw-column gotcha),
//  - extends the instrument_type / class_type / round_type enum CHECKs to admit
//    'ccps' on convertible, share_class and funding_round.
// Idempotent (IF [NOT] EXISTS / drop-if-exists) so it's safe to re-run on boot.
export class Migration20260711220000 extends Migration {

  async up(): Promise<void> {
    // --- convertible: CCPS columns ---
    this.addSql(`alter table if exists "convertible" add column if not exists "num_shares" numeric null;`);
    this.addSql(`alter table if exists "convertible" add column if not exists "raw_num_shares" jsonb null;`);
    this.addSql(`alter table if exists "convertible" add column if not exists "liquidation_preference_multiple" real null;`);
    this.addSql(`alter table if exists "convertible" add column if not exists "dividend_rate" real null;`);
    this.addSql(`alter table if exists "convertible" add column if not exists "conversion_ratio" real null;`);

    // --- convertible.instrument_type: allow 'ccps' ---
    this.addSql(`alter table if exists "convertible" drop constraint if exists "convertible_instrument_type_check";`);
    this.addSql(`alter table if exists "convertible" add constraint "convertible_instrument_type_check" check ("instrument_type" in ('safe', 'convertible_note', 'ccps'));`);

    // --- share_class.class_type: allow 'ccps' ---
    this.addSql(`alter table if exists "share_class" drop constraint if exists "share_class_class_type_check";`);
    this.addSql(`alter table if exists "share_class" add constraint "share_class_class_type_check" check ("class_type" in ('common', 'preferred', 'convertible_note', 'safe', 'ccps', 'warrant', 'option'));`);

    // --- funding_round.instrument_type + round_type: allow 'ccps' ---
    this.addSql(`alter table if exists "funding_round" drop constraint if exists "funding_round_instrument_type_check";`);
    this.addSql(`alter table if exists "funding_round" add constraint "funding_round_instrument_type_check" check ("instrument_type" in ('equity', 'safe', 'convertible_note', 'ccps'));`);
    this.addSql(`alter table if exists "funding_round" drop constraint if exists "funding_round_round_type_check";`);
    this.addSql(`alter table if exists "funding_round" add constraint "funding_round_round_type_check" check ("round_type" in ('pre_seed', 'seed', 'series_a', 'series_b', 'series_c', 'series_d_plus', 'bridge', 'debt', 'grant', 'safe', 'ccps'));`);
  }

  async down(): Promise<void> {
    this.addSql(`alter table if exists "funding_round" drop constraint if exists "funding_round_round_type_check";`);
    this.addSql(`alter table if exists "funding_round" add constraint "funding_round_round_type_check" check ("round_type" in ('pre_seed', 'seed', 'series_a', 'series_b', 'series_c', 'series_d_plus', 'bridge', 'debt', 'grant', 'safe'));`);
    this.addSql(`alter table if exists "funding_round" drop constraint if exists "funding_round_instrument_type_check";`);
    this.addSql(`alter table if exists "funding_round" add constraint "funding_round_instrument_type_check" check ("instrument_type" in ('equity', 'safe', 'convertible_note'));`);

    this.addSql(`alter table if exists "share_class" drop constraint if exists "share_class_class_type_check";`);
    this.addSql(`alter table if exists "share_class" add constraint "share_class_class_type_check" check ("class_type" in ('common', 'preferred', 'convertible_note', 'safe', 'warrant', 'option'));`);

    this.addSql(`alter table if exists "convertible" drop constraint if exists "convertible_instrument_type_check";`);
    this.addSql(`alter table if exists "convertible" add constraint "convertible_instrument_type_check" check ("instrument_type" in ('safe', 'convertible_note'));`);

    this.addSql(`alter table if exists "convertible" drop column if exists "conversion_ratio";`);
    this.addSql(`alter table if exists "convertible" drop column if exists "dividend_rate";`);
    this.addSql(`alter table if exists "convertible" drop column if exists "liquidation_preference_multiple";`);
    this.addSql(`alter table if exists "convertible" drop column if exists "raw_num_shares";`);
    this.addSql(`alter table if exists "convertible" drop column if exists "num_shares";`);
  }

}
