import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * #780 H7c — atomic claim for the partner assignment.
 *
 * Adds nullable `partner_assignment_id` to `inventory_orders`, holding the
 * workflow transaction id that owns the current assignment. The send-to-partner
 * workflow claims it with a conditional update (`where partner_assignment_id is
 * null`), so two concurrent sends to the same partner can no longer both create
 * tasks and both message the partner.
 *
 * Hand-written idempotent ALTER: the table exists on live DBs, and a generated
 * migration here would re-emit columns owned by earlier hand-written ones.
 */
export class Migration20260904090000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "inventory_orders" add column if not exists "partner_assignment_id" text null;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_inventory_orders_partner_assignment_id" ON "inventory_orders" (partner_assignment_id) WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_inventory_orders_partner_assignment_id";`);
    this.addSql(`alter table if exists "inventory_orders" drop column if exists "partner_assignment_id";`);
  }

}
