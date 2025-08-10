import { Migration } from '@mikro-orm/migrations';

export class Migration20250810060405 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "line_fulfillment" ("id" text not null, "quantity_delta" integer not null, "event_type" text check ("event_type" in ('sent', 'shipped', 'received', 'adjust', 'correction')) not null, "transaction_id" text not null, "notes" text not null, "metadata" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "line_fulfillment_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_line_fulfillment_deleted_at" ON "line_fulfillment" (deleted_at) WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "line_fulfillment" cascade;`);
  }

}
