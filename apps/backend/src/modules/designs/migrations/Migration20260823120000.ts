import { Migration } from "@mikro-orm/migrations"

/**
 * #938 — give a design a garment TYPE.
 *
 * `product_type` is what the design is ("trousers", "saree"); the pre-existing
 * `design_type` column answers how original it is and is left untouched.
 * `product_type_source` records whether a human typed the value or a model
 * inferred it, so an inferred type can be shown as provisional and a human
 * correction is never silently re-inferred over.
 *
 * Both nullable with no backfill: every existing design predates the concept,
 * and a guessed type written into history is indistinguishable from one a
 * designer chose. They are inferred on demand instead.
 */
export class Migration20260823120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "design" add column if not exists "product_type" text null;`
    )
    this.addSql(
      `alter table if exists "design" add column if not exists "product_type_source" text null;`
    )
    this.addSql(
      `alter table if exists "design" drop constraint if exists "design_product_type_source_check";`
    )
    this.addSql(
      `alter table if exists "design" add constraint "design_product_type_source_check" check ("product_type_source" in ('manual', 'inferred'));`
    )
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table if exists "design" drop constraint if exists "design_product_type_source_check";`
    )
    this.addSql(`alter table if exists "design" drop column if exists "product_type_source";`)
    this.addSql(`alter table if exists "design" drop column if exists "product_type";`)
  }

}
