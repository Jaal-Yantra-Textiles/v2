import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * JYT Stripe Connect (Standard) columns on partner_payment_config.
 *
 * Hand-written ADD COLUMN IF NOT EXISTS so it lands on existing databases —
 * editing the original `create table if not exists` migration would never run
 * on an already-provisioned DB.
 */
export class Migration20260702120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`ALTER TABLE IF EXISTS "partner_payment_config" ADD COLUMN IF NOT EXISTS "connect_account_id" text null;`);
    this.addSql(`ALTER TABLE IF EXISTS "partner_payment_config" ADD COLUMN IF NOT EXISTS "connect_status" text null;`);
    this.addSql(`ALTER TABLE IF EXISTS "partner_payment_config" ADD COLUMN IF NOT EXISTS "connect_charges_enabled" boolean not null default false;`);
    this.addSql(`ALTER TABLE IF EXISTS "partner_payment_config" ADD COLUMN IF NOT EXISTS "connect_payouts_enabled" boolean not null default false;`);
    this.addSql(`ALTER TABLE IF EXISTS "partner_payment_config" ADD COLUMN IF NOT EXISTS "connect_details_submitted" boolean not null default false;`);
    // Fast webhook lookup by connected account id.
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_partner_payment_config_connect_account_id" ON "partner_payment_config" ("connect_account_id") WHERE "connect_account_id" IS NOT NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "IDX_partner_payment_config_connect_account_id";`);
    this.addSql(`ALTER TABLE IF EXISTS "partner_payment_config" DROP COLUMN IF EXISTS "connect_account_id";`);
    this.addSql(`ALTER TABLE IF EXISTS "partner_payment_config" DROP COLUMN IF EXISTS "connect_status";`);
    this.addSql(`ALTER TABLE IF EXISTS "partner_payment_config" DROP COLUMN IF EXISTS "connect_charges_enabled";`);
    this.addSql(`ALTER TABLE IF EXISTS "partner_payment_config" DROP COLUMN IF EXISTS "connect_payouts_enabled";`);
    this.addSql(`ALTER TABLE IF EXISTS "partner_payment_config" DROP COLUMN IF EXISTS "connect_details_submitted";`);
  }

}
