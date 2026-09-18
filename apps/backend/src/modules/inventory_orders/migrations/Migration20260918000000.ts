import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Adds `inventory_order_change` — a partner's PROPOSED revision of an inventory
 * order (#1752): staged line edits/removals and `tax` charges that an admin
 * approves (post-ship) before they reach the real line/charge tables.
 *
 * Hand-written but verbatim the CREATE TABLE `medusa db:generate` emits for the
 * DML model (idempotent `if not exists`, so it is safe against a generated
 * follow-up). The DML model in models/order-change.ts is the runtime truth.
 */
export class Migration20260918000000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "inventory_order_change" ("id" text not null, "status" text check ("status" in ('pending', 'approved', 'rejected')) not null default 'pending', "proposed_lines" jsonb null, "proposed_charges" jsonb null, "submitted_by" text null, "submitted_at" timestamptz null, "decided_by" text null, "decided_at" timestamptz null, "rejection_reason" text null, "metadata" jsonb null, "inventory_orders_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "inventory_order_change_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_inventory_order_change_inventory_orders_id" ON "inventory_order_change" ("inventory_orders_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_inventory_order_change_deleted_at" ON "inventory_order_change" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "inventory_order_change" add constraint "inventory_order_change_inventory_orders_id_foreign" foreign key ("inventory_orders_id") references "inventory_orders" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "inventory_order_change" cascade;`);
  }

}