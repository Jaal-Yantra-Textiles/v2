import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * #1440 — promote the quote's buyer-identity ids out of `metadata` json into
 * real columns, and widen `status` to carry `superseded`.
 *
 * The mint has always recorded `customer_id`, `customer_group_id` and
 * `price_list_id`, but it recorded them in a json blob. That made the one query
 * #1435 needs — "which other active price lists does this buyer's group already
 * have?" — impossible through the module service, because a `list` filter
 * cannot reach into a json key. So a repeat quote stacked a second price list
 * on the same customer group and core tie-broke on `amount ASC`, handing a
 * re-quoted buyer the older, cheaper prices.
 *
 * The backfill deliberately does NOT strip the keys from `metadata`. Leaving
 * them costs nothing and keeps `down()` honest, and the revoke route reads the
 * column with a metadata fallback precisely so a half-applied rollout cannot
 * silently skip deleting a live price list. A follow-up can clear them once
 * this has been verified in production.
 */
export class Migration20260822061500 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "partner_quote" add column if not exists "customer_id" text null;`);
    this.addSql(`alter table if exists "partner_quote" add column if not exists "customer_group_id" text null;`);
    this.addSql(`alter table if exists "partner_quote" add column if not exists "price_list_id" text null;`);

    // The supersede lookup filters on this and nothing else.
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_partner_quote_customer_group_id" ON "partner_quote" ("customer_group_id") WHERE deleted_at IS NULL;`);

    // Backfill. `coalesce` so a re-run is a no-op rather than an overwrite.
    this.addSql(`update "partner_quote" set
      "customer_id" = coalesce("customer_id", "metadata"->>'customer_id'),
      "customer_group_id" = coalesce("customer_group_id", "metadata"->>'customer_group_id'),
      "price_list_id" = coalesce("price_list_id", "metadata"->>'price_list_id')
      where "metadata" is not null;`);

    // `status` gains `superseded`. The original check was declared inline at
    // create-table time, so Postgres auto-named it; `if exists` covers both the
    // conventional name and an already-migrated database.
    this.addSql(`alter table if exists "partner_quote" drop constraint if exists "partner_quote_status_check";`);
    this.addSql(`alter table if exists "partner_quote" add constraint "partner_quote_status_check" check ("status" in ('active', 'revoked', 'superseded'));`);
  }

  override async down(): Promise<void> {
    // Any row already marked superseded has no representation in the narrower
    // set. Fold it back to `revoked` rather than `active`: its price list has
    // been expired, so calling it active would describe a quote that cannot
    // price anything as though it still could.
    this.addSql(`update "partner_quote" set "status" = 'revoked' where "status" = 'superseded';`);
    this.addSql(`alter table if exists "partner_quote" drop constraint if exists "partner_quote_status_check";`);
    this.addSql(`alter table if exists "partner_quote" add constraint "partner_quote_status_check" check ("status" in ('active', 'revoked'));`);

    this.addSql(`DROP INDEX IF EXISTS "IDX_partner_quote_customer_group_id";`);
    this.addSql(`alter table if exists "partner_quote" drop column if exists "customer_id";`);
    this.addSql(`alter table if exists "partner_quote" drop column if exists "customer_group_id";`);
    this.addSql(`alter table if exists "partner_quote" drop column if exists "price_list_id";`);
  }

}
