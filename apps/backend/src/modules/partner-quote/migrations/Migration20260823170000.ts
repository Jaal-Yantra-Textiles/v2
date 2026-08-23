import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * #1420 — did the buyer actually get the link?
 *
 * 🔴 `email_sent_to` already exists and does NOT answer this. It is written by
 * `persistQuoteStep` at mint time from `buyer_email`, unconditionally and
 * before anything is sent, so it records the INTENDED recipient. Reading it as
 * "delivered" would report every quote ever minted as emailed, including the
 * months of them that were copy-pasted by hand because nothing sent anything.
 *
 * This column is written only after a provider accepted the message, so
 * `email_sent_at is null` is the honest list of quotes whose buyer link never
 * left the building — and that link is the only copy of the token.
 *
 * Nullable, no backfill, deliberately: every existing row genuinely was never
 * emailed by this system.
 */
export class Migration20260823170000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "partner_quote" add column if not exists "email_sent_at" timestamptz null;`
    )
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "partner_quote" drop column if exists "email_sent_at";`)
  }

}
