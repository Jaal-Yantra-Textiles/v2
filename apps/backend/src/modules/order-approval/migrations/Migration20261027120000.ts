import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261027120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "order_approval" drop constraint if exists "order_approval_token_hash_unique";`);
    this.addSql(`create table if not exists "order_approval" ("id" text not null, "order_id" text not null, "token_hash" text not null, "status" text check ("status" in ('pending', 'approved', 'rejected', 'superseded')) not null default 'pending', "photos" jsonb null, "note" text null, "sent_to" text null, "sent_by" text null, "expires_at" timestamptz null, "decided_at" timestamptz null, "decision_reason" text null, "balance_pay_url" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "order_approval_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_order_approval_order_id" ON "order_approval" ("order_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_order_approval_token_hash_unique" ON "order_approval" ("token_hash") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_order_approval_deleted_at" ON "order_approval" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "order_approval" cascade;`);
  }

}
