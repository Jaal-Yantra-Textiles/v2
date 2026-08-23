import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * #1439 S11 / #959 Slice C — the deposit/balance ledger.
 *
 * One table, keyed on the cart first and the order second: the deposit is what
 * turns the cart into an order, so a row has to exist before the order does.
 *
 * Every money column is a `bigNumber`, which in this ORM means a `numeric`
 * column plus a `raw_*` jsonb sidecar — the same shape the quote's own frozen
 * totals use.
 */
export class Migration20260823140000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(
      `create table if not exists "payment_schedule" (` +
        `"id" text not null, ` +
        `"cart_id" text null, ` +
        `"order_id" text null, ` +
        `"source_type" text check ("source_type" in ('quote', 'catalog_mto', 'manual')) not null default 'quote', ` +
        `"source_id" text null, ` +
        `"currency_code" text not null, ` +
        `"total_due" numeric not null, ` +
        `"deposit_pct" integer not null, ` +
        `"deposit_amount" numeric not null, ` +
        `"deposit_status" text check ("deposit_status" in ('pending', 'paid', 'failed', 'waived')) not null default 'pending', ` +
        `"deposit_paid_at" timestamptz null, ` +
        `"deposit_ref" text null, ` +
        `"balance_amount" numeric not null, ` +
        `"balance_status" text check ("balance_status" in ('not_due', 'due', 'paid', 'failed', 'waived')) not null default 'not_due', ` +
        `"balance_paid_at" timestamptz null, ` +
        `"balance_link_ref" text null, ` +
        `"balance_due_at" timestamptz null, ` +
        `"rail" text check ("rail" in ('payu', 'stripe', 'manual')) not null default 'manual', ` +
        `"metadata" jsonb null, ` +
        `"raw_total_due" jsonb null, ` +
        `"raw_deposit_amount" jsonb null, ` +
        `"raw_balance_amount" jsonb null, ` +
        `"created_at" timestamptz not null default now(), ` +
        `"updated_at" timestamptz not null default now(), ` +
        `"deleted_at" timestamptz null, ` +
        `constraint "payment_schedule_pkey" primary key ("id"));`
    )

    // One schedule per cart. Enforced in the database rather than by the
    // service alone: a double-submitted accept is the normal way this gets
    // called twice, and two schedules on one cart would each believe they hold
    // the whole deposit.
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_payment_schedule_cart_id_unique" ON "payment_schedule" ("cart_id") WHERE deleted_at IS NULL AND cart_id IS NOT NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_payment_schedule_order_id" ON "payment_schedule" ("order_id") WHERE deleted_at IS NULL;`
    )
    // Reconciliation reads by the gateway's own reference, so it gets an index
    // rather than a sequential scan over every schedule ever opened.
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_payment_schedule_deposit_ref" ON "payment_schedule" ("deposit_ref") WHERE deleted_at IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_payment_schedule_source" ON "payment_schedule" ("source_type", "source_id") WHERE deleted_at IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_payment_schedule_deleted_at" ON "payment_schedule" ("deleted_at") WHERE deleted_at IS NULL;`
    )
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "payment_schedule" cascade;`)
  }

}
