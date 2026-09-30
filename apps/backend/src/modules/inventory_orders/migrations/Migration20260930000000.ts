import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Adds supplier payment terms to `inventory_orders` (#2315): `payment_terms`
 * (`on_receipt` | `advance`, default `on_receipt`) and `advance_percent`.
 *
 * Hand-written idempotent ALTER, like Migration20260904130000: the table exists
 * on live DBs and a generated migration would re-emit columns owned by earlier
 * hand-written ones. The default backfills every existing row to `on_receipt`.
 */
export class Migration20260930000000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "inventory_orders" add column if not exists "payment_terms" text check ("payment_terms" in ('on_receipt', 'advance')) not null default 'on_receipt';`);
    this.addSql(`alter table if exists "inventory_orders" add column if not exists "advance_percent" integer null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "inventory_orders" drop column if exists "payment_terms";`);
    this.addSql(`alter table if exists "inventory_orders" drop column if exists "advance_percent";`);
  }

}
