import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261107090000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "payment_allocation" ("id" text not null, "payment_id" text not null, "payment_submission_id" text not null, "amount" numeric not null, "note" text null, "metadata" jsonb null, "raw_amount" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "payment_allocation_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_payment_allocation_deleted_at" ON "payment_allocation" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_payment_allocation_payment_id_payment_submission_id_unique" ON "payment_allocation" ("payment_id", "payment_submission_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_payment_allocation_payment_submission_id" ON "payment_allocation" ("payment_submission_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "payment_allocation" cascade;`);
  }

}
