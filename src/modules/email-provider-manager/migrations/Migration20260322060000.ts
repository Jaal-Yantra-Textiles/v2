import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260322060000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "email_queue" ("id" text not null, "to_email" text not null, "channel" text not null, "template" text not null, "data" text not null, "status" text check ("status" in ('pending', 'processing', 'sent', 'failed')) not null default 'pending', "scheduled_for" text not null, "attempts" integer not null default 0, "last_error" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "email_queue_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_email_queue_deleted_at" ON "email_queue" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_email_queue_status_scheduled" ON "email_queue" ("status", "scheduled_for") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "email_queue" cascade;`);
  }

}
