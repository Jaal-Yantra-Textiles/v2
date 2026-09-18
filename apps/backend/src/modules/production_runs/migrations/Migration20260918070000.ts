import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * #2122 — reminder state becomes one row per (run, rule).
 *
 * ⚠️ HAND-WRITTEN, not `db:generate`d. That command diffs the model against
 * whatever the LOCAL database happens to be, and a local db behind main makes
 * it re-emit every column main has added since — with a `down()` that DROPS
 * them. This migration adds one table and touches nothing that already exists,
 * so its `down()` is safe to run.
 *
 * The four `production_runs.reminder_*` columns are deliberately LEFT IN
 * PLACE. They are still dual-written, they are what the admin timeline and the
 * activity recorder read, and they are the fallback that keeps a run already
 * mid-cycle from restarting its count at zero. Nothing is backfilled: the
 * fallback read covers pre-existing rows, and a backfill would have to invent
 * a rule_key for rows whose `reminder_kind` is null.
 */
export class Migration20260918070000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "production_run_reminder" ("id" text not null, "production_run_id" text not null, "rule_key" text not null, "reminder_count" integer not null default 0, "reminder_status" text check ("reminder_status" in ('active', 'escalated', 'closed')) null, "last_reminded_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "production_run_reminder_pkey" primary key ("id"));`);
    this.addSql(`create index if not exists "IDX_production_run_reminder_deleted_at" on "production_run_reminder" ("deleted_at") where "deleted_at" is null;`);
    this.addSql(`create index if not exists "IDX_production_run_reminder_production_run_id" on "production_run_reminder" ("production_run_id") where "deleted_at" is null;`);
    // The invariant the whole change exists for: one counter per rule per run.
    this.addSql(`create unique index if not exists "IDX_production_run_reminder_production_run_id_rule_key_unique" on "production_run_reminder" ("production_run_id", "rule_key") where "deleted_at" is null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "production_run_reminder" cascade;`);
  }

}
