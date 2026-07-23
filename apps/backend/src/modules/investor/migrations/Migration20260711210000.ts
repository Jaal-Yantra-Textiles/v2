import { Migration } from '@mikro-orm/migrations';

// CORRECTIVE — #969 SAFE/convertible follow-up.
// The hand-rolled migrations 20260711180000 (convertible), 190000 (company_expense)
// and 200000 (funding_round SAFE cols) added the `numeric` side of each
// `model.bigNumber()` field but omitted its paired `raw_<field>` jsonb column
// (Medusa DML persists a BigNumber as `<field> numeric` + `raw_<field> jsonb`).
// Result: every query selecting these entities via `*` failed with
// `column ... raw_valuation_cap does not exist`, so the admin + investor cap-table
// reads threw and both UIs fell back to an empty state.
//
// This adds the missing raw_ columns idempotently and backfills them from the
// numeric value (shape `{ "value": "<n>", "precision": 20 }`). Safe to run on any
// DB regardless of whether the earlier migrations' fixed versions have applied.
export class Migration20260711210000 extends Migration {

  async up(): Promise<void> {
    // ---- convertible ----
    this.addSql(`alter table if exists "convertible" add column if not exists "raw_principal_amount" jsonb null;`);
    this.addSql(`alter table if exists "convertible" add column if not exists "raw_valuation_cap" jsonb null;`);
    this.addSql(`alter table if exists "convertible" add column if not exists "raw_conversion_price_per_share" jsonb null;`);
    this.addSql(`alter table if exists "convertible" add column if not exists "raw_conversion_shares" jsonb null;`);

    this.addSql(`update "convertible" set "raw_principal_amount" = json_build_object('value', "principal_amount"::text, 'precision', 20)::jsonb where "principal_amount" is not null and "raw_principal_amount" is null;`);
    this.addSql(`update "convertible" set "raw_valuation_cap" = json_build_object('value', "valuation_cap"::text, 'precision', 20)::jsonb where "valuation_cap" is not null and "raw_valuation_cap" is null;`);
    this.addSql(`update "convertible" set "raw_conversion_price_per_share" = json_build_object('value', "conversion_price_per_share"::text, 'precision', 20)::jsonb where "conversion_price_per_share" is not null and "raw_conversion_price_per_share" is null;`);
    this.addSql(`update "convertible" set "raw_conversion_shares" = json_build_object('value', "conversion_shares"::text, 'precision', 20)::jsonb where "conversion_shares" is not null and "raw_conversion_shares" is null;`);

    // principal_amount is NOT NULL in the model → its raw pair is too. Backfill covers
    // every row (principal_amount can't be null), so this set-not-null is safe.
    this.addSql(`alter table if exists "convertible" alter column "raw_principal_amount" set not null;`);

    // ---- company_expense ----
    this.addSql(`alter table if exists "company_expense" add column if not exists "raw_amount" jsonb null;`);
    this.addSql(`update "company_expense" set "raw_amount" = json_build_object('value', "amount"::text, 'precision', 20)::jsonb where "amount" is not null and "raw_amount" is null;`);
    this.addSql(`alter table if exists "company_expense" alter column "raw_amount" set not null;`);

    // ---- funding_round ----
    this.addSql(`alter table if exists "funding_round" add column if not exists "raw_valuation_cap" jsonb null;`);
    this.addSql(`update "funding_round" set "raw_valuation_cap" = json_build_object('value', "valuation_cap"::text, 'precision', 20)::jsonb where "valuation_cap" is not null and "raw_valuation_cap" is null;`);
  }

  async down(): Promise<void> {
    this.addSql(`alter table if exists "funding_round" drop column if exists "raw_valuation_cap";`);
    this.addSql(`alter table if exists "company_expense" drop column if exists "raw_amount";`);
    this.addSql(`alter table if exists "convertible" drop column if exists "raw_conversion_shares";`);
    this.addSql(`alter table if exists "convertible" drop column if exists "raw_conversion_price_per_share";`);
    this.addSql(`alter table if exists "convertible" drop column if exists "raw_valuation_cap";`);
    this.addSql(`alter table if exists "convertible" drop column if exists "raw_principal_amount";`);
  }

}
