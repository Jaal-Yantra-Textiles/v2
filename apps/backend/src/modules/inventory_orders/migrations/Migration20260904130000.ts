import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Adds nullable `extra_cost` to `inventory_order_line` — a per-unit extra
 * charge a partner bills on top of `price` (colour/dye job, finishing, …).
 *
 * Hand-written idempotent ALTER: the table exists on live DBs, and a generated
 * migration here would re-emit columns owned by earlier hand-written ones.
 */
export class Migration20260904130000 extends Migration {

  override async up(): Promise<void> {
    // `extra_cost` is a bigNumber, which Medusa DML models as TWO columns: the
    // numeric value and a `raw_<field>` jsonb carrying the raw BigNumber (value
    // + precision). Adding only the numeric column leaves the ORM writing to a
    // `raw_extra_cost` that does not exist.
    this.addSql(`alter table if exists "inventory_order_line" add column if not exists "extra_cost" numeric null;`);
    this.addSql(`alter table if exists "inventory_order_line" add column if not exists "raw_extra_cost" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "inventory_order_line" drop column if exists "extra_cost";`);
    this.addSql(`alter table if exists "inventory_order_line" drop column if exists "raw_extra_cost";`);
  }

}