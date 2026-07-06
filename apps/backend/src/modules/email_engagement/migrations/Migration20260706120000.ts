import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260706120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "email_engagement" ("id" text not null, "email" text not null, "delivered_count" integer not null default 0, "opens_count" integer not null default 0, "clicks_count" integer not null default 0, "delivered_since_last_open" integer not null default 0, "first_delivered_at" timestamptz null, "last_delivered_at" timestamptz null, "last_open_at" timestamptz null, "last_click_at" timestamptz null, "last_event_at" timestamptz null, "engagement_status" text check ("engagement_status" in ('engaged', 'cooling', 'dormant', 'never_opened', 'unknown')) not null default 'unknown', "status_computed_at" timestamptz null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "email_engagement_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_email_engagement_deleted_at" ON "email_engagement" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_email_engagement_email" ON "email_engagement" ("email") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "email_engagement_event" ("id" text not null, "email" text not null, "type" text check ("type" in ('delivered', 'open', 'click')) not null default 'delivered', "provider" text check ("provider" in ('mailjet', 'resend', 'other')) not null default 'other', "event_id" text null, "event_at" timestamptz null, "message_id" text null, "raw" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "email_engagement_event_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_email_engagement_event_deleted_at" ON "email_engagement_event" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_email_engagement_event_email" ON "email_engagement_event" ("email") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_email_engagement_event_event_id" ON "email_engagement_event" ("event_id") WHERE deleted_at IS NULL AND event_id IS NOT NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "email_engagement" cascade;`);
    this.addSql(`drop table if exists "email_engagement_event" cascade;`);
  }

}
