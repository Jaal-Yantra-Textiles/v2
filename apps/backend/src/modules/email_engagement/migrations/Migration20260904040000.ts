import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * #1785 — the Kit snapshot columns on `email_engagement`.
 *
 * Kit reports ABSOLUTE per-subscriber totals; the existing counters are folded
 * one webhook event at a time. Storing what Kit last told us makes the backfill
 * idempotent (apply a delta, not the total) and keeps the transactional
 * history from the Mailjet/Resend webhooks intact.
 *
 * HAND-WRITTEN, not generated. `db:generate` re-emits every model it sees for a
 * module with no MikroORM snapshot, and its `down()` would drop columns these
 * migrations never created.
 */
export class Migration20260904040000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "email_engagement" add column if not exists "kit_sent" integer not null default 0;`);
    this.addSql(`alter table if exists "email_engagement" add column if not exists "kit_opened" integer not null default 0;`);
    this.addSql(`alter table if exists "email_engagement" add column if not exists "kit_clicked" integer not null default 0;`);
    this.addSql(`alter table if exists "email_engagement" add column if not exists "kit_synced_at" timestamptz null;`);
  }

  override async down(): Promise<void> {
    // Only the four columns this migration added — nothing else in the table.
    this.addSql(`alter table if exists "email_engagement" drop column if exists "kit_sent";`);
    this.addSql(`alter table if exists "email_engagement" drop column if exists "kit_opened";`);
    this.addSql(`alter table if exists "email_engagement" drop column if exists "kit_clicked";`);
    this.addSql(`alter table if exists "email_engagement" drop column if exists "kit_synced_at";`);
  }
}
