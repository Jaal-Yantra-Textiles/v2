import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * #1439 S12 — freight a person named, and why.
 *
 * The stored international option is a flat amount at any weight, and the
 * cross-border carrier leg answers "no serviceable couriers available for given
 * weight". Until the carriers work, the honest freight figure is the one the
 * partner has from a forwarder — so it can be typed, and where it came from is
 * recorded beside it.
 *
 * Both nullable with no backfill. A quote minted before this column has no
 * recorded provenance, and stamping every one of them `estimated` would assert
 * something nobody checked.
 */
export class Migration20260823150000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "partner_quote" add column if not exists "quoted_freight_source" text null;`
    )
    this.addSql(
      `alter table if exists "partner_quote" add column if not exists "quoted_freight_basis" text null;`
    )
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "partner_quote" drop column if exists "quoted_freight_basis";`)
    this.addSql(`alter table if exists "partner_quote" drop column if exists "quoted_freight_source";`)
  }

}
