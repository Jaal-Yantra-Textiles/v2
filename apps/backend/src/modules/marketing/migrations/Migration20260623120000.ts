import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * #659 slice 1 — the `marketing` module foundation: 5 typed tables for the
 * AI-VP-of-Marketing data layer. Hand-written (not db:generate) so it lands on
 * existing DBs; every table uses `create table if not exists` (safe on existing
 * DBs — the hazard is only column-ADDs to a create-if-not-exists table).
 *
 * Class name Migration20260623120000 is globally unique across all modules
 * (grep-verified) — Medusa tracks migrations by class name in a SHARED table, so
 * a collision would silently skip this and the tables would never land.
 */
export class Migration20260623120000 extends Migration {

  override async up(): Promise<void> {
    // marketing_metric_snapshot — append-only headline/trend rows
    this.addSql(`create table if not exists "marketing_metric_snapshot" ("id" text not null, "metric_key" text not null, "value" real not null default 0, "unit" text null, "captured_for_date" timestamptz not null, "source" text null, "breakdown" jsonb null, "delta_dod" real null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "marketing_metric_snapshot_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_marketing_metric_snapshot_deleted_at" ON "marketing_metric_snapshot" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_marketing_metric_snapshot_key_date" ON "marketing_metric_snapshot" ("metric_key", "captured_for_date") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_marketing_metric_snapshot_captured_for_date" ON "marketing_metric_snapshot" ("captured_for_date") WHERE deleted_at IS NULL;`);

    // marketing_outreach — hand-crafted outbound (Winbacks / Exec)
    this.addSql(`create table if not exists "marketing_outreach" ("id" text not null, "recipient_email" text not null, "recipient_name" text null, "company" text null, "status" text check ("status" in ('queued', 'sent', 'opened', 'replied', 'bounced', 'unknown')) not null default 'queued', "channel" text check ("channel" in ('email', 'whatsapp', 'manual')) not null default 'email', "campaign" text null, "sent_at" timestamptz null, "opened_at" timestamptz null, "replied_at" timestamptz null, "bounce_unreliable" boolean not null default false, "notes" text null, "external_id" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "marketing_outreach_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_marketing_outreach_deleted_at" ON "marketing_outreach" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_marketing_outreach_recipient_email" ON "marketing_outreach" ("recipient_email") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_marketing_outreach_campaign" ON "marketing_outreach" ("campaign") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_marketing_outreach_status" ON "marketing_outreach" ("status") WHERE deleted_at IS NULL;`);

    // marketing_draft — newsletter/campaign drafts by name
    this.addSql(`create table if not exists "marketing_draft" ("id" text not null, "name" text not null, "kind" text check ("kind" in ('newsletter', 'campaign', 'ideas_email')) not null default 'newsletter', "status" text check ("status" in ('draft', 'approved', 'sent', 'discarded')) not null default 'draft', "payload" jsonb not null, "model_used" text null, "approved_by" text null, "sent_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "marketing_draft_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_marketing_draft_deleted_at" ON "marketing_draft" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_marketing_draft_name" ON "marketing_draft" ("name") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_marketing_draft_kind_status" ON "marketing_draft" ("kind", "status") WHERE deleted_at IS NULL;`);

    // marketing_manual_override — operator corrections to computed data
    this.addSql(`create table if not exists "marketing_manual_override" ("id" text not null, "metric_key" text not null, "effective_date" timestamptz not null, "override_value" real not null, "reason" text not null, "actor_id" text not null, "active" boolean not null default true, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "marketing_manual_override_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_marketing_manual_override_deleted_at" ON "marketing_manual_override" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_marketing_manual_override_key_date" ON "marketing_manual_override" ("metric_key", "effective_date") WHERE deleted_at IS NULL;`);

    // marketing_ideas_log — one row per generated tactical-ideas email
    this.addSql(`create table if not exists "marketing_ideas_log" ("id" text not null, "generated_for_date" timestamptz not null, "model_used" text null, "prompt_snapshot" jsonb not null, "output_text" text not null, "guard_passed" boolean not null default false, "guard_failures" jsonb null, "regenerated" boolean not null default false, "sent" boolean not null default false, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "marketing_ideas_log_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_marketing_ideas_log_deleted_at" ON "marketing_ideas_log" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_marketing_ideas_log_generated_for_date" ON "marketing_ideas_log" ("generated_for_date") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_marketing_ideas_log_guard_passed" ON "marketing_ideas_log" ("guard_passed") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "marketing_metric_snapshot" cascade;`);
    this.addSql(`drop table if exists "marketing_outreach" cascade;`);
    this.addSql(`drop table if exists "marketing_draft" cascade;`);
    this.addSql(`drop table if exists "marketing_manual_override" cascade;`);
    this.addSql(`drop table if exists "marketing_ideas_log" cascade;`);
  }

}
