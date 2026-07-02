import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Material-group flexibility (additive) — generalize groups beyond the built-in
 * `color` axis WITHOUT breaking anything.
 *
 * - `raw_material_group.dimensions` (jsonb): operator-defined extra variant axes
 *   ({ key, label, values? }[]). Null/empty ⇒ color-only (today's behavior).
 * - `raw_materials.attributes` (jsonb): per-member variant coordinates keyed by
 *   those dimensions ({ color, finish, … }). `color` column stays the canonical
 *   display/denorm key.
 *
 * Hand-written idempotent ALTER (add-column-if-not-exists): both tables already
 * exist on live DBs, so editing their create-table migrations would never land
 * these columns on existing databases (the create-if-not-exists hazard).
 */
export class Migration20260702120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "raw_material_group" add column if not exists "dimensions" jsonb null;`);
    this.addSql(`alter table if exists "raw_materials" add column if not exists "attributes" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "raw_material_group" drop column if exists "dimensions";`);
    this.addSql(`alter table if exists "raw_materials" drop column if exists "attributes";`);
  }

}
