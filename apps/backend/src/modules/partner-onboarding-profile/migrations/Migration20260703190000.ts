import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Adds supplies_to_platform to partner_onboarding_profile (#859 / #861).
 *
 * Hand-written (Claude-owned) ALTER migration — idempotent ADD COLUMN so it
 * lands on existing databases (editing the create-table migration would no-op;
 * see the repo "migration create-if-not-exists hazard" note).
 *
 * supplies_to_platform: true when JYT places production / inventory orders WITH
 * this partner (handloom supplier / manufacturer). Orthogonal to selling_mode —
 * a partner can list on the marketplace AND supply us.
 */
export class Migration20260703190000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "partner_onboarding_profile" add column if not exists "supplies_to_platform" boolean null;`
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table if exists "partner_onboarding_profile" drop column if exists "supplies_to_platform";`
    );
  }

}
