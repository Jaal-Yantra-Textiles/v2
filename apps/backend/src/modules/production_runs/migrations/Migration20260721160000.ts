import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * #1112 — retail-order → production run (product-as-spine provenance).
 *
 * Relaxes `production_runs.design_id` to nullable so a retail-fulfillment run
 * can be minted for a product with NO backing design (the product-only path).
 * Design work-orders continue to set it; `createProductionRunWorkflow` branches
 * on presence.
 *
 * Hand-written incremental ALTER (the generator emits a full snapshot, a no-op
 * on the existing prod table). See memory
 * `reference_medusa_migration_create_if_not_exists_hazard`.
 */
export class Migration20260721160000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "production_runs" alter column "design_id" drop not null;`
    );
  }

  override async down(): Promise<void> {
    // Best-effort restore: only valid when no product-only rows exist.
    this.addSql(
      `alter table if exists "production_runs" alter column "design_id" set not null;`
    );
  }
}
