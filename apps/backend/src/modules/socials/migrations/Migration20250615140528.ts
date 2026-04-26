import { Migration } from '@mikro-orm/migrations';

export class Migration20250615140528 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "sma" ("id" text not null, "platform" text not null, "access_token" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "sma_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_sma_deleted_at" ON "sma" (deleted_at) WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "social_platform" ("id" text not null, "name" text not null, "icon_url" text null, "base_url" text null, "api_config" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "social_platform_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_social_platform_deleted_at" ON "social_platform" (deleted_at) WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "social_post" ("id" text not null, "post_url" text null, "caption" text null, "status" text check ("status" in ('draft', 'scheduled', 'posted', 'failed', 'archived')) not null, "scheduled_at" timestamptz null, "posted_at" timestamptz null, "insights" jsonb null, "media_attachments" jsonb null, "notes" text null, "error_message" text null, "related_item_type" text null, "related_item_id" text null, "platform_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "social_post_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_social_post_platform_id" ON "social_post" (platform_id) WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_social_post_deleted_at" ON "social_post" (deleted_at) WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "social_post" add constraint "social_post_platform_id_foreign" foreign key ("platform_id") references "social_platform" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "social_post" drop constraint if exists "social_post_platform_id_foreign";`);

    this.addSql(`drop table if exists "sma" cascade;`);

    this.addSql(`drop table if exists "social_platform" cascade;`);

    this.addSql(`drop table if exists "social_post" cascade;`);
  }

}
