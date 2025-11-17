import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20251115122118 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "hashtag" ("id" text not null, "tag" text not null, "platform" text check ("platform" in ('facebook', 'instagram', 'twitter', 'all')) not null default 'all', "usage_count" integer not null default 0, "last_used_at" timestamptz null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "hashtag_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_hashtag_deleted_at" ON "hashtag" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "mention" ("id" text not null, "username" text not null, "display_name" text null, "platform" text check ("platform" in ('facebook', 'instagram', 'twitter')) not null, "platform_user_id" text null, "usage_count" integer not null default 0, "last_used_at" timestamptz null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "mention_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_mention_deleted_at" ON "mention" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "hashtag" cascade;`);

    this.addSql(`drop table if exists "mention" cascade;`);
  }

}
