import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Promote the partner's custom domain out of `metadata` into typed columns
 * (`custom_domain`, `custom_domain_verified`).
 *
 * Hand-written (Claude-owned) migration. The custom domain is load-bearing —
 * it drives the storefront domain-status API, host resolution and the
 * marketing-base derivation — so it belongs in typed columns, not the JSON
 * `metadata` blob (mirrors the `tax_id` / `country_code` convention on this
 * model). Uses `add column if not exists` per the repo "migration
 * create-if-not-exists hazard".
 *
 * Data move: copy `metadata.custom_domain` / `metadata.custom_domain_verified`
 * into the new columns for existing partners, then strip those two keys from
 * metadata so the domain lives in exactly one place. Migrations run (gated)
 * ahead of the new code rolling, so the columns are populated before any
 * reader depends on them.
 */
export class Migration20260718120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "partner" add column if not exists "custom_domain" text null;`
    );
    this.addSql(
      `alter table if exists "partner" add column if not exists "custom_domain_verified" boolean not null default false;`
    );

    // Backfill from metadata (JSONB) for existing partners. Uses the
    // `jsonb_exists()` function rather than the `?` operator, which collides
    // with SQL bind-placeholder handling in the migration driver.
    this.addSql(
      `update "partner"
         set "custom_domain" = "metadata"->>'custom_domain'
       where "custom_domain" is null
         and "metadata" is not null
         and coalesce("metadata"->>'custom_domain', '') <> '';`
    );
    this.addSql(
      `update "partner"
         set "custom_domain_verified" = true
       where "metadata" is not null
         and ("metadata"->>'custom_domain_verified') = 'true';`
    );

    // Strip the migrated keys so the domain lives only in the typed columns.
    this.addSql(
      `update "partner"
         set "metadata" = ("metadata" - 'custom_domain' - 'custom_domain_verified')
       where "metadata" is not null
         and (jsonb_exists("metadata", 'custom_domain')
              or jsonb_exists("metadata", 'custom_domain_verified'));`
    );
  }

  override async down(): Promise<void> {
    // Restore the keys into metadata before dropping the columns (best-effort).
    this.addSql(
      `update "partner"
         set "metadata" = coalesce("metadata", '{}'::jsonb)
           || jsonb_build_object(
                'custom_domain', "custom_domain",
                'custom_domain_verified', "custom_domain_verified"
              )
       where "custom_domain" is not null;`
    );
    this.addSql(
      `alter table if exists "partner" drop column if exists "custom_domain_verified";`
    );
    this.addSql(
      `alter table if exists "partner" drop column if exists "custom_domain";`
    );
  }

}
