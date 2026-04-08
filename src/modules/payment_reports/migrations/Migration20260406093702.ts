import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260406093702 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "payment_reconciliation" ("id" text not null, "reference_type" text check ("reference_type" in ('payment_submission', 'inventory_order', 'manual')) not null default 'manual', "reference_id" text null, "partner_id" text null, "expected_amount" numeric not null, "actual_amount" numeric null, "discrepancy" numeric null, "status" text check ("status" in ('Pending', 'Matched', 'Discrepant', 'Settled', 'Waived')) not null default 'Pending', "payment_id" text null, "settled_at" timestamptz null, "settled_by" text null, "notes" text null, "metadata" jsonb null, "raw_expected_amount" jsonb not null, "raw_actual_amount" jsonb null, "raw_discrepancy" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "payment_reconciliation_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_payment_reconciliation_deleted_at" ON "payment_reconciliation" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "payment_reconciliation" cascade;`);
  }

}
