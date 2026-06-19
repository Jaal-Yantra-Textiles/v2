import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260619120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "partner_fee" ("id" text not null, "partner_id" text not null, "order_id" text not null, "order_total" numeric not null, "raw_order_total" jsonb not null, "currency_code" text not null, "fee_basis" text check ("fee_basis" in ('percentage', 'flat')) not null default 'percentage', "fee_rate" integer not null, "fee_amount" numeric not null, "raw_fee_amount" jsonb not null, "status" text check ("status" in ('accrued', 'invoiced', 'waived', 'reversed')) not null default 'accrued', "accrued_at" timestamptz null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "partner_fee_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_partner_fee_deleted_at" ON "partner_fee" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_partner_fee_partner_id" ON "partner_fee" ("partner_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_partner_fee_order_id" ON "partner_fee" ("order_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "partner_fee" cascade;`);
  }

}
