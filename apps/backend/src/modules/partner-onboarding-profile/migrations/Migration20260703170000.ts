import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Adds selling_mode + commission_bps to partner_onboarding_profile (#859 S1 / #860).
 *
 * Hand-written (Claude-owned) ALTER migration. Editing the original
 * create-table migration would never land on existing databases (the
 * `create table if not exists` no-ops once the table exists — see the repo
 * "migration create-if-not-exists hazard" note), so these are added as
 * idempotent `ADD COLUMN IF NOT EXISTS` statements.
 *
 * - selling_mode: how the partner sells (own storefront vs core-channel listing).
 * - commission_bps: agreed commission in basis points; null → platform default.
 */
export class Migration20260703170000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "partner_onboarding_profile" add column if not exists "selling_mode" text check ("selling_mode" in ('dedicated_storefront', 'core_channel_listing')) null;`
    );
    this.addSql(
      `alter table if exists "partner_onboarding_profile" add column if not exists "commission_bps" integer null;`
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table if exists "partner_onboarding_profile" drop column if exists "selling_mode";`
    );
    this.addSql(
      `alter table if exists "partner_onboarding_profile" drop column if exists "commission_bps";`
    );
  }

}
