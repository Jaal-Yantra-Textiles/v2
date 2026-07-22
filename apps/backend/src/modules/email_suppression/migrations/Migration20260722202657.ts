import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Add "kit" to the `email_suppression.provider` check constraint so the Kit
 * (kit.com) webhook lane can write suppression audit rows. [#1059]
 *
 * db:generate emits a create-if-not-exists for this module (it predates
 * snapshots, #1024) which cannot alter an existing constraint — so we follow it
 * with an idempotent constraint swap that is correct on both existing and fresh
 * DBs (the swap runs after the original create migration on a fresh DB).
 */
export class Migration20260722202657 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "email_suppression" ("id" text not null, "email" text not null, "reason" text check ("reason" in ('hard_bounce', 'soft_bounce', 'spam_complaint', 'unsubscribe', 'manual')) not null default 'hard_bounce', "provider" text check ("provider" in ('mailjet', 'resend', 'kit', 'manual', 'other')) not null default 'other', "event_id" text null, "event_at" timestamptz null, "suppressed" boolean not null default false, "persons" integer not null default 0, "customers" integer not null default 0, "leads" integer not null default 0, "raw" jsonb null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "email_suppression_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_email_suppression_deleted_at" ON "email_suppression" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`alter table "email_suppression" drop constraint if exists "email_suppression_provider_check";`);
    this.addSql(`alter table "email_suppression" add constraint "email_suppression_provider_check" check ("provider" in ('mailjet', 'resend', 'kit', 'manual', 'other'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "email_suppression" drop constraint if exists "email_suppression_provider_check";`);
    this.addSql(`alter table "email_suppression" add constraint "email_suppression_provider_check" check ("provider" in ('mailjet', 'resend', 'manual', 'other'));`);
  }

}
