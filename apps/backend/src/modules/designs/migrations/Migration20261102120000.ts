import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Adds `design.color_mode` (#2500): whether a design's colours are separate
 * colourways (`variants`, the default and today's behaviour) or parts of one
 * piece (`parts`, e.g. base fabric + contrast embroidery).
 *
 * Every existing row becomes `variants`, so nothing about an existing design or
 * run changes. Re-running is a no-op.
 */
export class Migration20261102120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "design" add column if not exists "color_mode" text not null default 'variants';`
    );
    this.addSql(
      `alter table if exists "design" drop constraint if exists "design_color_mode_check";`
    );
    this.addSql(
      `alter table if exists "design" add constraint "design_color_mode_check" check ("color_mode" in ('variants', 'parts'));`
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table if exists "design" drop constraint if exists "design_color_mode_check";`
    );
    this.addSql(`alter table if exists "design" drop column if exists "color_mode";`);
  }

}
