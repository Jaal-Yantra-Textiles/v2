import { Migration } from "@mikro-orm/migrations"

/**
 * A quote can be a DRAFT (#1446 — the draft-order mirror).
 *
 * Minting was one shot: a form held every answer in the browser and a single
 * POST created a fully priced quote. That is not how the draft-order rail this
 * is modelled on works. There, a small modal captures only what is needed to
 * make the row — region, sales channel, customer, address — saves it, and the
 * items, shipping and promotions are edited section by section afterwards.
 *
 * So a quote gains the same shape, and the same first state.
 *
 * ## What a draft is allowed to be missing
 *
 * The table's NOT NULL columns are `partner_id`, `destination_country_code`,
 * `currency_code`, `token_hash` and `status`. The first three are exactly what
 * the create modal asks for — which is the check that the modal's field list is
 * the right one, arrived at from the schema rather than from taste.
 *
 * 🔴 `token_hash` is the one a draft cannot have. It is the buyer's credential,
 * minted once and never recoverable, so it cannot be invented at draft time and
 * then thrown away. It becomes nullable: in Postgres a UNIQUE constraint admits
 * many NULLs, so drafts do not collide with each other.
 *
 * 🔑 That nullability is also the SAFETY property. `findByTokenHash` matches on
 * `token_hash`, and NULL is never equal to anything — so a draft is unreachable
 * from the buyer-facing token route by construction, not by a guard somebody
 * has to remember to write. A draft is an unpriced quote; showing one to a
 * buyer would be showing them a price that does not exist yet.
 *
 * ## The enum is a CHECK constraint
 *
 * Adding a value means dropping and re-adding it — exactly as
 * `Migration20260822061500` did for `superseded`. This has bitten before: the
 * column's own docblock described a `"manual"` weight source the constraint had
 * never learned, and every quote minted with a hand-typed weight died at the
 * INSERT with a bare CheckConstraintViolationException.
 */
export class Migration20260904120000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      `alter table if exists "partner_quote" drop constraint if exists "partner_quote_status_check";`
    )
    this.addSql(
      `alter table if exists "partner_quote" add constraint "partner_quote_status_check" check ("status" in ('draft', 'active', 'revoked', 'superseded'));`
    )
    this.addSql(
      `alter table if exists "partner_quote" alter column "token_hash" drop not null;`
    )
  }

  async down(): Promise<void> {
    /**
     * 🔴 Drafts must go before the constraint can refuse them, or `down`
     * fails on any database that has one. They are deleted rather than
     * promoted: an unpriced quote has no business becoming `active`, which is
     * the state the buyer-facing routes serve.
     */
    this.addSql(`delete from "partner_quote" where "status" = 'draft';`)
    this.addSql(
      `alter table if exists "partner_quote" drop constraint if exists "partner_quote_status_check";`
    )
    this.addSql(
      `alter table if exists "partner_quote" add constraint "partner_quote_status_check" check ("status" in ('active', 'revoked', 'superseded'));`
    )
    /**
     * Restoring NOT NULL would fail on any row left without a token, so the
     * column stays nullable. A `down` that cannot run is worse than one that
     * leaves a column wider than it found it.
     */
  }
}
