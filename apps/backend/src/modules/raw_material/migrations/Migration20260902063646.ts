import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * `raw_materials.description` was the only description in this module that was
 * NOT nullable — `material_type` and `raw_material_group` both are — while the
 * route validator marked it `.optional()`. Omitting it therefore reached
 * MikroORM as a required-property violation and surfaced as an unhandled 500
 * with an HTML body rather than a 400 naming the field (#1737).
 *
 * ⚠️ The generator also re-emitted `raw_materials.attributes` and six
 * `raw_material_group` columns, all already shipped by Migration20260702120000
 * and Migration20260701140000 — hand-written, so the snapshot never recorded
 * them. Stripped: the `up` was idempotent, but the `down` would have dropped
 * columns another migration owns.
 */
export class Migration20260902063646 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "raw_materials" alter column "description" drop not null;`);
  }

  override async down(): Promise<void> {
    /**
     * ⚠️ Deliberately NOT re-adding NOT NULL. By the time this runs there may
     * be rows with a null description, and the constraint would fail to apply —
     * a down migration that cannot run is worse than one that leaves the column
     * permissive.
     */
  }

}
