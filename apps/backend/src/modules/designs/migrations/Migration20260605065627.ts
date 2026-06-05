import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Roadmap #6 (partner design self-serve) — add `owner_partner_id` to
 * the `design` table so partner-created designs can be attributed +
 * excluded from the global admin list by default.
 *
 * Hand-written as an incremental ALTER (the auto-generator emitted a
 * full `create table if not exists` snapshot, which is a no-op on the
 * existing prod `design` table and would never add the column).
 * `if not exists` keeps it idempotent + safe to re-run.
 */
export class Migration20260605065627 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "design" add column if not exists "owner_partner_id" text null;`
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table if exists "design" drop column if exists "owner_partner_id";`
    );
  }
}
