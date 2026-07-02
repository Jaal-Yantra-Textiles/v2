import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Partner billing locale — add `country_code` + `currency_code` to `partner`.
 *
 * Load-bearing for subscription payment-provider routing (INR → PayU, else
 * Stripe), so typed columns rather than metadata. Set during onboarding; the
 * subscription route prefers these over the legacy `metadata.currency_code`.
 *
 * Hand-written idempotent ALTER (add-column-if-not-exists) because `partner`
 * already exists on live DBs (the create-if-not-exists migration hazard).
 */
export class Migration20260702140000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "partner" add column if not exists "country_code" text null;`);
    this.addSql(`alter table if exists "partner" add column if not exists "currency_code" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "partner" drop column if exists "country_code";`);
    this.addSql(`alter table if exists "partner" drop column if exists "currency_code";`);
  }

}
