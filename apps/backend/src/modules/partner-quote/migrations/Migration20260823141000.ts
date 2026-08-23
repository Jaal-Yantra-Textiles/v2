import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * #1439 S11 — what acceptance needs the quote to remember.
 *
 * - `quoted_shipping_option_id`: which option the frozen freight was rated
 *   against, so the accepted cart's freight option is built in the same service
 *   zone and shipping profile rather than in whichever zone a fresh lookup
 *   picks. See the model docblock for why the cart cannot simply be handed an
 *   amount.
 * - `deposit_pct`: the deposit share, frozen per deal.
 * - `accepted_cart_id` / `accepted_at`: the acceptance itself. The cart id is
 *   the idempotency key — a double-submitted accept returns the same cart
 *   instead of minting a second one against the same price list.
 *
 * All nullable, no backfill. A quote minted before S11 has no acceptance and no
 * agreed deposit, and inventing either would be a claim about a deal nobody
 * made.
 */
export class Migration20260823141000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "partner_quote" add column if not exists "quoted_shipping_option_id" text null;`
    )
    this.addSql(
      `alter table if exists "partner_quote" add column if not exists "deposit_pct" integer null;`
    )
    this.addSql(
      `alter table if exists "partner_quote" add column if not exists "accepted_cart_id" text null;`
    )
    this.addSql(
      `alter table if exists "partner_quote" add column if not exists "accepted_at" timestamptz null;`
    )
    // Acceptance is read back by cart on the payment path, so it gets an index
    // rather than a scan over every quote ever minted.
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_partner_quote_accepted_cart_id" ON "partner_quote" ("accepted_cart_id") WHERE deleted_at IS NULL AND accepted_cart_id IS NOT NULL;`
    )
  }

  override async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "IDX_partner_quote_accepted_cart_id";`)
    this.addSql(`alter table if exists "partner_quote" drop column if exists "accepted_at";`)
    this.addSql(`alter table if exists "partner_quote" drop column if exists "accepted_cart_id";`)
    this.addSql(`alter table if exists "partner_quote" drop column if exists "deposit_pct";`)
    this.addSql(
      `alter table if exists "partner_quote" drop column if exists "quoted_shipping_option_id";`
    )
  }

}
