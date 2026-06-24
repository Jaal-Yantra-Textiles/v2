import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Roadmap #604 (Design Brief / Collection Concept) — Slice A RE-APPLY.
 *
 * Migration20260622120000 added 6 design-brief columns to the `design` table,
 * but on prod NONE of them landed: the migration was recorded-but-not-executed
 * on first deploy (the same failure mode as #722). Because it is already
 * recorded in mikro_orm_migrations it will never re-run, so prod is left
 * missing every brief column. The design service selects ALL design columns
 * (incl. concept_theme) when loading related Design entities, so
 * `/admin/designs/:id/components` and `/admin/designs/:id/used-in` 500 with
 * `column c1.concept_theme does not exist` / `p1.concept_theme does not exist`.
 *
 * This migration re-issues the EXACT same idempotent ALTER statements as
 * Migration20260622120000.up() under a fresh (un-recorded) class name so it
 * actually executes on the next deploy. `add column if not exists` makes it a
 * safe no-op anywhere the columns already exist (e.g. local/dev DBs where the
 * original migration did run) and adds the missing ones on prod.
 *
 * After merge + deploy this unblocks /admin/designs/:id/components and
 * /admin/designs/:id/used-in on prod.
 */
export class Migration20260624180000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "design" add column if not exists "concept_theme" text null;`
    );
    this.addSql(
      `alter table if exists "design" add column if not exists "persona" jsonb null;`
    );
    this.addSql(
      `alter table if exists "design" add column if not exists "competitors" jsonb null;`
    );
    this.addSql(
      `alter table if exists "design" add column if not exists "price_point" text null;`
    );
    this.addSql(
      `alter table if exists "design" add column if not exists "design_budget" numeric null;`
    );
    // bigNumber columns carry a companion raw_* jsonb column holding the
    // full-precision value (mirrors raw_estimated_cost / raw_material_cost).
    this.addSql(
      `alter table if exists "design" add column if not exists "raw_design_budget" jsonb null;`
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table if exists "design" drop column if exists "concept_theme";`
    );
    this.addSql(
      `alter table if exists "design" drop column if exists "persona";`
    );
    this.addSql(
      `alter table if exists "design" drop column if exists "competitors";`
    );
    this.addSql(
      `alter table if exists "design" drop column if exists "price_point";`
    );
    this.addSql(
      `alter table if exists "design" drop column if exists "design_budget";`
    );
    this.addSql(
      `alter table if exists "design" drop column if exists "raw_design_budget";`
    );
  }
}
