import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * S2 of #817 — denormalize color identity onto the inventory order line.
 *
 * Adds nullable `color`, `material_name`, and `raw_material_id` to
 * `inventory_order_line` (populated at creation time from the line's linked
 * inventory_item → raw_material). Hand-written idempotent ALTER because the
 * table already exists on live DBs (see the create-if-not-exists migration
 * hazard). Existing lines stay null; the module link remains source of truth.
 */
export class Migration20260701130000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "inventory_order_line" add column if not exists "color" text null, add column if not exists "material_name" text null, add column if not exists "raw_material_id" text null;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_inventory_order_line_raw_material_id" ON "inventory_order_line" (raw_material_id) WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_inventory_order_line_raw_material_id";`);
    this.addSql(`alter table if exists "inventory_order_line" drop column if exists "color", drop column if exists "material_name", drop column if exists "raw_material_id";`);
  }

}
