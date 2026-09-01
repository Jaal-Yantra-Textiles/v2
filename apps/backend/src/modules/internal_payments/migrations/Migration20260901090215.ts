import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260901090215 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "partner_credit" ("id" text not null, "amount" numeric not null, "currency_code" text not null default 'inr', "status" text check ("status" in ('Open', 'Applied', 'Cancelled')) not null default 'Open', "source_type" text check ("source_type" in ('overpayment', 'adjustment', 'goodwill')) not null default 'overpayment', "reason" text not null, "source_submission_id" text null, "applied_to_submission_id" text null, "applied_at" timestamptz null, "metadata" jsonb null, "raw_amount" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "partner_credit_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_partner_credit_deleted_at" ON "partner_credit" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "partner_credit" cascade;`);
  }

}
