import { Migration } from "@mikro-orm/migrations";

/**
 * #1676 — a run may state NO agreed quantity.
 *
 * `quantity` has always been `not null default 1`, so "no agreed amount" was
 * unrepresentable: an unset quantity read as a run ordered for ONE piece, which
 * is the most restrictive ceiling possible rather than the absence of one.
 *
 * From #1676 every payment claim — including a run's FIRST claim — is bounded
 * by that quantity. A null is the explicit, per-run opt-out from that ceiling:
 * ongoing work with no fixed order, billed as it comes.
 *
 * 🔴 The DEFAULT stays 1. Dropping it would silently turn every future insert
 * that omits the column into an open-ended, unguarded run — the opposite of
 * this feature, which must be declared deliberately. Only an explicit null
 * declares it.
 *
 * No backfill and no retro-nulling: every existing row keeps the quantity it
 * has and behaves exactly as before.
 */
export class Migration20260831120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`
      alter table if exists "production_runs"
        alter column "quantity" drop not null;
    `);
  }

  /**
   * ⚠️ NOT symmetric, and cannot be. Re-imposing `not null` would fail on any
   * row that has since been declared open-ended, so the down path has to decide
   * what those runs were ordered for — and there is no honest answer. It writes
   * 1, the value the column defaulted to before this migration, which restores
   * the pre-migration READING of an unset quantity (a run ordered for one) and
   * with it the tightest possible ceiling. That is the safe direction: it can
   * refuse a claim that would have been allowed, never allow one that would
   * have been refused.
   */
  override async down(): Promise<void> {
    this.addSql(`update "production_runs" set "quantity" = 1 where "quantity" is null;`);
    this.addSql(`
      alter table if exists "production_runs"
        alter column "quantity" set not null;
    `);
  }

}
