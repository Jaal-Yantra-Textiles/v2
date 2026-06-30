import { Migration } from '@mikro-orm/migrations';

/**
 * #778 group 5 (H-hygiene) — inventory-order data-layer hardening:
 *
 *  1. Indexes on the columns the admin/partner lists actually filter & sort by
 *     (status, is_sample, order_date, expected_delivery_date). These were
 *     missing despite the API supporting filtering/sorting on them.
 *  2. CHECK constraints so quantity / price can never go negative at the DB
 *     level — defence in depth behind the Zod validators (which already enforce
 *     `nonnegative`). Note: `>= 0`, NOT `> 0` — sample orders and freshly seeded
 *     order lines legitimately carry quantity 0.
 *
 * All statements are idempotent (hand-written ALTER, never edit the create-table
 * migration — that only runs on fresh DBs and would never land on existing/prod
 * databases; recurring hazard). `create index if not exists` is natively
 * idempotent; CHECK constraints are guarded via pg_constraint DO-blocks because
 * Postgres has no `add constraint if not exists`.
 */
export class Migration20260630160000 extends Migration {

  override async up(): Promise<void> {
    // --- Indexes -----------------------------------------------------------
    this.addSql(`create index if not exists "IDX_inventory_orders_status" on "inventory_orders" ("status");`);
    this.addSql(`create index if not exists "IDX_inventory_orders_is_sample" on "inventory_orders" ("is_sample");`);
    this.addSql(`create index if not exists "IDX_inventory_orders_order_date" on "inventory_orders" ("order_date");`);
    this.addSql(`create index if not exists "IDX_inventory_orders_expected_delivery_date" on "inventory_orders" ("expected_delivery_date");`);

    // --- CHECK constraints (idempotent via pg_constraint guard) -------------
    this.addSql(`do $$ begin
      if not exists (select 1 from pg_constraint where conname = 'inventory_orders_quantity_check') then
        alter table "inventory_orders" add constraint "inventory_orders_quantity_check" check ("quantity" >= 0);
      end if;
      if not exists (select 1 from pg_constraint where conname = 'inventory_orders_total_price_check') then
        alter table "inventory_orders" add constraint "inventory_orders_total_price_check" check ("total_price" >= 0);
      end if;
      if not exists (select 1 from pg_constraint where conname = 'inventory_order_line_quantity_check') then
        alter table "inventory_order_line" add constraint "inventory_order_line_quantity_check" check ("quantity" >= 0);
      end if;
      if not exists (select 1 from pg_constraint where conname = 'inventory_order_line_price_check') then
        alter table "inventory_order_line" add constraint "inventory_order_line_price_check" check ("price" >= 0);
      end if;
    end $$;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "inventory_orders" drop constraint if exists "inventory_orders_quantity_check";`);
    this.addSql(`alter table if exists "inventory_orders" drop constraint if exists "inventory_orders_total_price_check";`);
    this.addSql(`alter table if exists "inventory_order_line" drop constraint if exists "inventory_order_line_quantity_check";`);
    this.addSql(`alter table if exists "inventory_order_line" drop constraint if exists "inventory_order_line_price_check";`);

    this.addSql(`drop index if exists "IDX_inventory_orders_status";`);
    this.addSql(`drop index if exists "IDX_inventory_orders_is_sample";`);
    this.addSql(`drop index if exists "IDX_inventory_orders_order_date";`);
    this.addSql(`drop index if exists "IDX_inventory_orders_expected_delivery_date";`);
  }

}
