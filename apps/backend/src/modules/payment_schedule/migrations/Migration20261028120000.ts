import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * A deposit can be a fixed amount (Cherry's ₹800, 2026-10-28). A fixed deposit
 * has no percentage, so `deposit_pct` becomes nullable. Existing rows keep
 * their percentage — no backfill.
 */
export class Migration20261028120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "payment_schedule" alter column "deposit_pct" drop not null;`
    )
  }

  override async down(): Promise<void> {
    this.addSql(
      `update "payment_schedule" set "deposit_pct" = 0 where "deposit_pct" is null;`
    )
    this.addSql(
      `alter table if exists "payment_schedule" alter column "deposit_pct" set not null;`
    )
  }
}
