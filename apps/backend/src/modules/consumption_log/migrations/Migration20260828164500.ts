import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Let a consumption log hang off a PRODUCT, not only a design.
 *
 * `design_id text not null` encoded an assumption that stopped being true when
 * product-only production runs shipped (#1112): a run minted from
 * `order.fulfillment_created` for a product with no backing design consumes
 * real material, and there was nowhere to record it. Both admin and partner
 * capture routes are design-scoped, and the run-scoped partner route refuses
 * outright with "Production run has no design linked".
 *
 * 🔴 The CHECK is the load-bearing half. Making `design_id` nullable on its own
 * would allow a log anchored to NOTHING — no design, no product — which is a
 * row that can never be costed, committed or reconciled, and nothing else in
 * the schema would refuse it. The pair must stay total, and it already is in
 * the data: of 122 production runs on prod, 110 are design-only, 8 are
 * product-only, 4 carry both and ZERO carry neither.
 *
 * This mirrors `production_runs`, which has carried the same nullable pair
 * since #1112 and branches on presence. It is also the first step of #938
 * Phase 2 ("re-parent operational links … consumption logs … from design to
 * product"), done without pretending Phase 0 has landed — product is NOT yet a
 * universal key, covering only 12 of those 122 runs.
 *
 * ⚠️ `down()` re-asserts NOT NULL and will FAIL LOUDLY if any product-only log
 * has been written by then. That is deliberate: those rows are the only record
 * of material consumed on a product-only run, and a rollback that quietly
 * deleted them to satisfy the constraint would destroy production data to make
 * a schema change reversible.
 */
export class Migration20260828164500 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "consumption_log" add column if not exists "product_id" text null;`);
    this.addSql(`alter table if exists "consumption_log" add column if not exists "variant_id" text null;`);
    this.addSql(`alter table if exists "consumption_log" alter column "design_id" drop not null;`);

    // Every existing row is design-backed, so this validates without a rewrite.
    this.addSql(`alter table if exists "consumption_log" drop constraint if exists "consumption_log_design_or_product_check";`);
    this.addSql(`alter table if exists "consumption_log" add constraint "consumption_log_design_or_product_check" check ("design_id" is not null or "product_id" is not null);`);

    // Anchored lookups: both columns are filtered on by the run-scoped capture
    // and commit paths, and neither is the primary key.
    this.addSql(`create index if not exists "IDX_consumption_log_product_id" on "consumption_log" ("product_id") where "product_id" is not null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_consumption_log_product_id";`);
    this.addSql(`alter table if exists "consumption_log" drop constraint if exists "consumption_log_design_or_product_check";`);
    this.addSql(`alter table if exists "consumption_log" alter column "design_id" set not null;`);
    this.addSql(`alter table if exists "consumption_log" drop column if exists "variant_id";`);
    this.addSql(`alter table if exists "consumption_log" drop column if exists "product_id";`);
  }

}
