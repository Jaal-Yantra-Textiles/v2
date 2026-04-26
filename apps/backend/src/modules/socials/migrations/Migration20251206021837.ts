import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20251206021837 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "publishing_campaign" ("id" text not null, "name" text not null, "status" text check ("status" in ('draft', 'preview', 'active', 'paused', 'completed', 'cancelled')) not null default 'draft', "content_rule" jsonb not null, "interval_hours" integer not null default 24, "items" jsonb not null, "current_index" integer not null default 0, "started_at" timestamptz null, "completed_at" timestamptz null, "paused_at" timestamptz null, "error_message" text null, "metadata" jsonb null, "platform_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "publishing_campaign_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_publishing_campaign_platform_id" ON "publishing_campaign" ("platform_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_publishing_campaign_deleted_at" ON "publishing_campaign" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "publishing_campaign" add constraint "publishing_campaign_platform_id_foreign" foreign key ("platform_id") references "social_platform" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "publishing_campaign" cascade;`);
  }

}
