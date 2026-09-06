import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Add the admin "edit / changes" surface to person_property:
 * `social_media`, `corrections`, `custom_fields` (all JSON).
 *
 * Hand-written, `add column if not exists` per the repo migration hazard note.
 * The primary persistence is the MikroHyperbee KV store (append-only, keyed by
 * census_id); these columns exist only so the flag-off Postgres fallback keeps
 * parity with the contract and never drops the fields.
 */
export class Migration20260906140000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "person_property" add column if not exists "social_media" jsonb null;`
    );
    this.addSql(
      `alter table if exists "person_property" add column if not exists "corrections" jsonb null;`
    );
    this.addSql(
      `alter table if exists "person_property" add column if not exists "custom_fields" jsonb null;`
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table if exists "person_property" drop column if exists "social_media";`
    );
    this.addSql(
      `alter table if exists "person_property" drop column if exists "corrections";`
    );
    this.addSql(
      `alter table if exists "person_property" drop column if exists "custom_fields";`
    );
  }
}