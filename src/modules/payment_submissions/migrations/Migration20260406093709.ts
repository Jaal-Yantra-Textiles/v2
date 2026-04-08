import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260406093709 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "payment_submission" ("id" text not null, "partner_id" text not null, "status" text check ("status" in ('Draft', 'Pending', 'Under_Review', 'Approved', 'Rejected', 'Paid')) not null default 'Draft', "total_amount" numeric not null, "currency" text not null default 'inr', "submitted_at" timestamptz null, "reviewed_at" timestamptz null, "reviewed_by" text null, "rejection_reason" text null, "notes" text null, "documents" jsonb null, "metadata" jsonb null, "raw_total_amount" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "payment_submission_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_payment_submission_deleted_at" ON "payment_submission" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "payment_submission_item" ("id" text not null, "design_id" text not null, "design_name" text null, "amount" numeric not null, "cost_breakdown" jsonb null, "metadata" jsonb null, "submission_id" text not null, "raw_amount" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "payment_submission_item_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_payment_submission_item_submission_id" ON "payment_submission_item" ("submission_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_payment_submission_item_deleted_at" ON "payment_submission_item" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "payment_submission_item" add constraint "payment_submission_item_submission_id_foreign" foreign key ("submission_id") references "payment_submission" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "payment_submission_item" drop constraint if exists "payment_submission_item_submission_id_foreign";`);

    this.addSql(`drop table if exists "payment_submission" cascade;`);

    this.addSql(`drop table if exists "payment_submission_item" cascade;`);
  }

}
