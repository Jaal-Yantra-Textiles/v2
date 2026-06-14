import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260614184932 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "unified_order_status" ("id" text not null, "partner_status" text check ("partner_status" in ('assigned', 'accepted', 'in_progress', 'finished', 'partial', 'completed', 'declined')) not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "unified_order_status_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_unified_order_status_deleted_at" ON "unified_order_status" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "unified_order_status" cascade;`);
  }

}
