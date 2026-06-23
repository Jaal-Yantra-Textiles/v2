import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Adds "Newsletter" to the page.page_type check constraint so operators can
 * create/edit a Newsletter by reusing the existing blog editor and inherit the
 * blog → subscriber send path. MikroORM names the inline column check
 * "<table>_<column>_check" → "page_page_type_check".
 *
 * NOTE: must NOT edit the create-table migration (Migration20250417085315) —
 * `create table if not exists` never re-runs on existing DBs. This is a
 * hand-written ALTER that drops + re-adds the constraint, mirroring the
 * precedent in payment_reports/Migration20260311034841.
 */
export class Migration20260623130000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "page" drop constraint if exists "page_page_type_check";`);
    this.addSql(`alter table if exists "page" add constraint "page_page_type_check" check ("page_type" in ('Home', 'About', 'Contact', 'Blog', 'Product', 'Service', 'Portfolio', 'Landing', 'Custom', 'Newsletter'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "page" drop constraint if exists "page_page_type_check";`);
    this.addSql(`alter table if exists "page" add constraint "page_page_type_check" check ("page_type" in ('Home', 'About', 'Contact', 'Blog', 'Product', 'Service', 'Portfolio', 'Landing', 'Custom'));`);
  }

}
