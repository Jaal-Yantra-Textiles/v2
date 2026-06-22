import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * #348 slice B — create the admin-managed `platform_tax_identity` table and seed
 * the two real platform brand identities.
 *
 * Hand-written `create table if not exists` (NOT a generated migration) so it
 * lands cleanly on existing DBs — see memory:
 * reference_medusa_migration_create_if_not_exists_hazard. The seed is idempotent
 * (`on conflict (id) do nothing`) with deterministic ids so re-runs are no-ops.
 */
export class Migration20260622140000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "platform_tax_identity" (
      "id" text not null,
      "brand_code" text not null,
      "legal_name" text not null,
      "tax_id" text not null,
      "tax_id_type" text not null,
      "country_codes" text[] not null,
      "is_active" boolean not null default true,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "platform_tax_identity_pkey" primary key ("id")
    );`);

    this.addSql(`create index if not exists "IDX_platform_tax_identity_deleted_at" on "platform_tax_identity" ("deleted_at") where "deleted_at" is null;`);

    // Seed the two real platform identities (idempotent).
    this.addSql(`insert into "platform_tax_identity"
      ("id", "brand_code", "legal_name", "tax_id", "tax_id_type", "country_codes", "is_active")
      values (
        'ptid_jyt_in',
        'JYT',
        'Jaal Yantra Textiles Private Limited',
        '07AAGCJ0494A1ZV',
        'gstin',
        ARRAY['IN'],
        true
      )
      on conflict ("id") do nothing;`);

    this.addSql(`insert into "platform_tax_identity"
      ("id", "brand_code", "legal_name", "tax_id", "tax_id_type", "country_codes", "is_active")
      values (
        'ptid_kht_eu',
        'KHT',
        'Kind Health Tech',
        '40203579735',
        'eu_vat',
        ARRAY['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE'],
        true
      )
      on conflict ("id") do nothing;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "platform_tax_identity" cascade;`);
  }

}
