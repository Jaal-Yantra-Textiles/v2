import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * The finished piece's size on the production spec.
 *
 * Three nullable columns and nothing else, so this is idempotent and safe to
 * re-run — the #1208 concern. Every existing spec keeps working with all three
 * null, which is exactly what "no size stated" means everywhere downstream.
 */
export class Migration20260824140000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "product_spec" add column if not exists "finished_length_cm" integer null;`);
    this.addSql(`alter table if exists "product_spec" add column if not exists "finished_width_cm" integer null;`);
    this.addSql(`alter table if exists "product_spec" add column if not exists "size_label" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "product_spec" drop column if exists "finished_length_cm";`);
    this.addSql(`alter table if exists "product_spec" drop column if exists "finished_width_cm";`);
    this.addSql(`alter table if exists "product_spec" drop column if exists "size_label";`);
  }

}
