import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * #1216 — create `platform_export_lut`: one row per financial year recording an
 * export LUT (GST form RFD-11) furnished by a platform tax identity.
 *
 * Hand-written `create table if not exists` rather than generated, matching
 * Migration20260622140000 and
 * memory:reference_medusa_migration_create_if_not_exists_hazard.
 *
 * The foreign key is declared INSIDE the create-table so it is covered by
 * `if not exists`. A separate `alter table … add constraint` would re-run and
 * fail on a DB that already has the table — the non-idempotent pattern tracked
 * in #1208. No seed: there is no ARN yet, and inventing one would be a false
 * declaration.
 *
 * ⚠️ The timestamp is 1600, not 1200, because MikroORM tracks migrations by NAME
 * in ONE shared `mikro_orm_migrations` table across every module — and
 * `partner_billing/Migration20260806120000` already exists (#1206, same day).
 * With the colliding name this migration was recorded as already-executed and
 * SKIPPED: `db:migrate` said "Migrations completed" and created no table. See
 * memory:reference_medusa_migration_name_collision. Any new migration must be
 * checked against `find src -name "Migration<ts>.ts"` before it ships.
 */
export class Migration20260806160000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "platform_export_lut" (
      "id" text not null,
      "arn" text not null,
      "financial_year" text not null,
      "valid_from" timestamptz not null,
      "valid_to" timestamptz not null,
      "filed_on" timestamptz null,
      "notes" text null,
      "is_active" boolean not null default true,
      "tax_identity_id" text not null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "platform_export_lut_pkey" primary key ("id"),
      constraint "platform_export_lut_tax_identity_id_foreign"
        foreign key ("tax_identity_id")
        references "platform_tax_identity" ("id")
        on update cascade on delete cascade
    );`);

    this.addSql(`create index if not exists "IDX_platform_export_lut_deleted_at" on "platform_export_lut" ("deleted_at") where "deleted_at" is null;`);

    this.addSql(`create index if not exists "IDX_platform_export_lut_tax_identity_id" on "platform_export_lut" ("tax_identity_id") where "deleted_at" is null;`);

    // The resolver's hot path: active rows whose validity window covers today.
    this.addSql(`create index if not exists "IDX_platform_export_lut_validity" on "platform_export_lut" ("valid_from", "valid_to") where "deleted_at" is null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "platform_export_lut" cascade;`);
  }

}
