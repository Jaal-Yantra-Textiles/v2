import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Adds partner.tax_id / tax_id_type (roadmap #348 slice A).
 *
 * Renamed from Migration20260622120000 → ...120001 to break a migration-name
 * collision: the `designs` module shipped a Migration20260622120000 on the same
 * day (PR #653). Medusa tracks executed migrations by class name in a tracking
 * table shared across modules, so whichever ran first (designs, alphabetically)
 * recorded "Migration20260622120000" and this partner migration was skipped as
 * "up-to-date" — meaning tax_id never landed in any DB (incl. prod). A unique
 * timestamp makes it run independently. `add column if not exists` keeps it
 * idempotent on DBs where it may have partially applied.
 */
export class Migration20260622120001 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "partner" add column if not exists "tax_id" text null;`);
    this.addSql(`alter table if exists "partner" add column if not exists "tax_id_type" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "partner" drop column if exists "tax_id";`);
    this.addSql(`alter table if exists "partner" drop column if exists "tax_id_type";`);
  }

}
