import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Roadmap #604 (Design Brief / Collection Concept) — Slice A.
 *
 * Adds the design-brief fields that did not previously exist on the `design`
 * table (the rest of the brief — concept text, moodboard, palette, tags,
 * milestones via tasks, manufacturing cost — already had a home):
 *   - concept_theme  : short story/title (Section 1, Core Identity)
 *   - persona        : { age_range, lifestyle, values[], pain_points[] } (Section 2)
 *   - competitors    : [{ name, url?, differentiator }] (Section 2)
 *   - price_point    : positioning tier luxury|mid_market|budget (Section 2)
 *   - design_budget  : design-phase budget, distinct from material/production cost (Section 3)
 *
 * Hand-written as an incremental ALTER. The auto-generator emits a full
 * `create table if not exists` snapshot, which is a NO-OP on the existing prod
 * `design` table and would never add these columns (documented hazard).
 * `if not exists` keeps each statement idempotent + safe to re-run.
 */
export class Migration20260622120000 extends Migration {
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
