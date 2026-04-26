import { Migration } from '@mikro-orm/migrations';

export class Migration20250105072006 extends Migration {

  async up(): Promise<void> {
    this.addSql('create table if not exists "internal_payment_details" ("id" text not null, "type" text check ("type" in (\'bank_account\', \'cash_account\', \'digital_wallet\')) not null, "account_name" text not null, "account_number" text null, "bank_name" text null, "ifsc_code" text null, "wallet_id" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "internal_payment_details_pkey" primary key ("id"));');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_internal_payment_details_deleted_at" ON "internal_payment_details" (deleted_at) WHERE deleted_at IS NULL;');

    this.addSql('create table if not exists "internal_payments" ("id" text not null, "amount" numeric not null, "status" text check ("status" in (\'Pending\', \'Processing\', \'Completed\', \'Failed\', \'Cancelled\')) not null default \'Pending\', "payment_type" text check ("payment_type" in (\'Bank\', \'Cash\', \'Digital_Wallet\')) not null, "payment_date" timestamptz not null, "metadata" jsonb null, "paid_to_id" text not null, "raw_amount" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "internal_payments_pkey" primary key ("id"));');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_internal_payments_paid_to_id" ON "internal_payments" (paid_to_id) WHERE deleted_at IS NULL;');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_internal_payments_deleted_at" ON "internal_payments" (deleted_at) WHERE deleted_at IS NULL;');

    this.addSql('alter table if exists "internal_payments" add constraint "internal_payments_paid_to_id_foreign" foreign key ("paid_to_id") references "internal_payment_details" ("id") on update cascade;');
  }

  async down(): Promise<void> {
    this.addSql('alter table if exists "internal_payments" drop constraint if exists "internal_payments_paid_to_id_foreign";');

    this.addSql('drop table if exists "internal_payment_details" cascade;');

    this.addSql('drop table if exists "internal_payments" cascade;');
  }

}
