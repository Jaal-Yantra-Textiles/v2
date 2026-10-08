import { Migration } from "@mikro-orm/migrations";

/**
 * #2289 S3 — `inventory_shortfall`: a receiver counted less than the supplier
 * dispatched on an inventory order line.
 *
 * HAND-WRITTEN, not `db:generate`d — same reasoning as Migration20261008090000.
 */
export class Migration20261008120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "inventory_shortfall" (
      "id" text not null,
      "inventory_order_id" text not null,
      "inventory_order_line_id" text not null,
      "quantity" real not null,
      "dispatched_quantity" real not null,
      "received_quantity" real not null,
      "status" text check ("status" in ('open', 'resolved')) not null default 'open',
      "counted_by_partner_id" text null,
      "counted_by" text null,
      "resolved_at" timestamptz null,
      "resolution_note" text null,
      "task_id" text null,
      "metadata" jsonb null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "inventory_shortfall_pkey" primary key ("id")
    );`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_inventory_shortfall_order_id" ON "inventory_shortfall" ("inventory_order_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_inventory_shortfall_line_id" ON "inventory_shortfall" ("inventory_order_line_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_inventory_shortfall_deleted_at" ON "inventory_shortfall" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "inventory_shortfall" cascade;`);
  }

}
