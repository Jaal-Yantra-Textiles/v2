import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260317040742 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "partner_plan" drop constraint if exists "partner_plan_slug_unique";`);
    this.addSql(`create table if not exists "partner_plan" ("id" text not null, "name" text not null, "slug" text not null, "description" text null, "price" real not null default 0, "currency_code" text not null default 'inr', "interval" text check ("interval" in ('monthly', 'yearly')) not null default 'monthly', "features" jsonb null, "is_active" boolean not null default true, "sort_order" integer not null default 0, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "partner_plan_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_partner_plan_slug_unique" ON "partner_plan" ("slug") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_partner_plan_deleted_at" ON "partner_plan" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "partner_subscription" ("id" text not null, "partner_id" text not null, "status" text check ("status" in ('active', 'canceled', 'expired', 'past_due')) not null default 'active', "current_period_start" timestamptz not null, "current_period_end" timestamptz null, "canceled_at" timestamptz null, "metadata" jsonb null, "plan_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "partner_subscription_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_partner_subscription_plan_id" ON "partner_subscription" ("plan_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_partner_subscription_deleted_at" ON "partner_subscription" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "partner_subscription" add constraint "partner_subscription_plan_id_foreign" foreign key ("plan_id") references "partner_plan" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "partner_subscription" drop constraint if exists "partner_subscription_plan_id_foreign";`);

    this.addSql(`drop table if exists "partner_plan" cascade;`);

    this.addSql(`drop table if exists "partner_subscription" cascade;`);
  }

}
