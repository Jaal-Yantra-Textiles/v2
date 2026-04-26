import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260317165831 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "subscription_payment" ("id" text not null, "amount" real not null, "currency_code" text not null default 'inr', "status" text check ("status" in ('pending', 'processing', 'completed', 'failed', 'refunded')) not null default 'pending', "provider" text check ("provider" in ('payu', 'stripe', 'manual')) not null default 'manual', "provider_reference_id" text null, "provider_data" jsonb null, "period_start" timestamptz not null, "period_end" timestamptz not null, "paid_at" timestamptz null, "failed_at" timestamptz null, "failure_reason" text null, "metadata" jsonb null, "subscription_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "subscription_payment_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_subscription_payment_subscription_id" ON "subscription_payment" ("subscription_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_subscription_payment_deleted_at" ON "subscription_payment" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "subscription_payment" add constraint "subscription_payment_subscription_id_foreign" foreign key ("subscription_id") references "partner_subscription" ("id") on update cascade;`);

    this.addSql(`alter table if exists "partner_subscription" add column if not exists "payment_provider" text check ("payment_provider" in ('payu', 'stripe', 'manual')) not null default 'manual';`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "subscription_payment" cascade;`);

    this.addSql(`alter table if exists "partner_subscription" drop column if exists "payment_provider";`);
  }

}
