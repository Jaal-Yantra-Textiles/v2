import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260704120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "email_suppression" ("id" text not null, "email" text not null, "reason" text check ("reason" in ('hard_bounce', 'soft_bounce', 'spam_complaint', 'unsubscribe', 'manual')) not null default 'hard_bounce', "provider" text check ("provider" in ('mailjet', 'resend', 'manual', 'other')) not null default 'other', "event_id" text null, "event_at" timestamptz null, "suppressed" boolean not null default false, "persons" integer not null default 0, "customers" integer not null default 0, "leads" integer not null default 0, "raw" jsonb null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "email_suppression_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_email_suppression_deleted_at" ON "email_suppression" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_email_suppression_email" ON "email_suppression" ("email") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_email_suppression_event_id" ON "email_suppression" ("event_id") WHERE deleted_at IS NULL AND event_id IS NOT NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "email_suppression" cascade;`);
  }

}
