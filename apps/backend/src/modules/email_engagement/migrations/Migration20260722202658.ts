import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Add "kit" to the `email_engagement_event.provider` check constraint so the Kit
 * (kit.com) webhook lane can record click engagement. [#1059]
 *
 * As with the suppression sibling, db:generate emits a create-if-not-exists for
 * this snapshot-less module (#1024); the trailing idempotent constraint swap is
 * what actually widens the enum on already-existing tables.
 */
export class Migration20260722202658 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "email_engagement" ("id" text not null, "email" text not null, "delivered_count" integer not null default 0, "opens_count" integer not null default 0, "clicks_count" integer not null default 0, "delivered_since_last_open" integer not null default 0, "first_delivered_at" timestamptz null, "last_delivered_at" timestamptz null, "last_open_at" timestamptz null, "last_click_at" timestamptz null, "last_event_at" timestamptz null, "engagement_status" text check ("engagement_status" in ('engaged', 'cooling', 'dormant', 'never_opened', 'unknown')) not null default 'unknown', "status_computed_at" timestamptz null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "email_engagement_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_email_engagement_deleted_at" ON "email_engagement" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "email_engagement_event" ("id" text not null, "email" text not null, "type" text check ("type" in ('delivered', 'open', 'click')) not null default 'delivered', "provider" text check ("provider" in ('mailjet', 'resend', 'kit', 'other')) not null default 'other', "event_id" text null, "event_at" timestamptz null, "message_id" text null, "raw" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "email_engagement_event_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_email_engagement_event_deleted_at" ON "email_engagement_event" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`alter table "email_engagement_event" drop constraint if exists "email_engagement_event_provider_check";`);
    this.addSql(`alter table "email_engagement_event" add constraint "email_engagement_event_provider_check" check ("provider" in ('mailjet', 'resend', 'kit', 'other'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "email_engagement_event" drop constraint if exists "email_engagement_event_provider_check";`);
    this.addSql(`alter table "email_engagement_event" add constraint "email_engagement_event_provider_check" check ("provider" in ('mailjet', 'resend', 'other'));`);
  }

}
