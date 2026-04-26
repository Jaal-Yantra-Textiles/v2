import { Migration } from '@mikro-orm/migrations';

export class Migration20250730085502 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "album" drop constraint if exists "album_slug_unique";`);
    this.addSql(`alter table if exists "folder" drop constraint if exists "folder_slug_unique";`);
    this.addSql(`create table if not exists "folder" ("id" text not null, "name" text not null, "slug" text not null, "description" text null, "path" text not null, "level" integer not null default 0, "sort_order" integer not null default 0, "is_public" boolean not null default true, "metadata" jsonb null, "parent_folder_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "folder_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_folder_slug_unique" ON "folder" (slug) WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_folder_parent_folder_id" ON "folder" (parent_folder_id) WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_folder_deleted_at" ON "folder" (deleted_at) WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "album_media" ("id" text not null, "sort_order" integer not null default 0, "title" text null, "description" text null, "album_id" text not null, "media_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "album_media_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_album_media_album_id" ON "album_media" (album_id) WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_album_media_media_id" ON "album_media" (media_id) WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_album_media_deleted_at" ON "album_media" (deleted_at) WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "folder" add constraint "folder_parent_folder_id_foreign" foreign key ("parent_folder_id") references "folder" ("id") on update cascade;`);

    this.addSql(`alter table if exists "album_media" add constraint "album_media_album_id_foreign" foreign key ("album_id") references "album" ("id") on update cascade;`);
    this.addSql(`alter table if exists "album_media" add constraint "album_media_media_id_foreign" foreign key ("media_id") references "media_file" ("id") on update cascade;`);

    this.addSql(`alter table if exists "media_file" add column if not exists "original_name" text not null, add column if not exists "file_hash" text null, add column if not exists "extension" text not null, add column if not exists "width" integer null, add column if not exists "height" integer null, add column if not exists "duration" integer null, add column if not exists "caption" text null, add column if not exists "folder_path" text not null default '/', add column if not exists "folder_id" text not null;`);
    this.addSql(`alter table if exists "media_file" alter column "alt_text" type text using ("alt_text"::text);`);
    this.addSql(`alter table if exists "media_file" alter column "alt_text" drop not null;`);
    this.addSql(`alter table if exists "media_file" alter column "title" type text using ("title"::text);`);
    this.addSql(`alter table if exists "media_file" alter column "title" drop not null;`);
    this.addSql(`alter table if exists "media_file" alter column "description" type text using ("description"::text);`);
    this.addSql(`alter table if exists "media_file" alter column "description" drop not null;`);
    this.addSql(`alter table if exists "media_file" alter column "metadata" type jsonb using ("metadata"::jsonb);`);
    this.addSql(`alter table if exists "media_file" alter column "metadata" drop not null;`);
    this.addSql(`alter table if exists "media_file" alter column "tags" type jsonb using ("tags"::jsonb);`);
    this.addSql(`alter table if exists "media_file" alter column "tags" drop not null;`);
    this.addSql(`alter table if exists "media_file" alter column "is_public" type boolean using ("is_public"::boolean);`);
    this.addSql(`alter table if exists "media_file" alter column "is_public" set default true;`);
    this.addSql(`alter table if exists "media_file" add constraint "media_file_folder_id_foreign" foreign key ("folder_id") references "folder" ("id") on update cascade;`);
    this.addSql(`alter table if exists "media_file" add constraint "media_file_file_type_check" check("file_type" in ('image', 'video', 'audio', 'document', 'archive', 'other'));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_media_file_folder_id" ON "media_file" (folder_id) WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "album" add column if not exists "slug" text not null, add column if not exists "type" text check ("type" in ('gallery', 'portfolio', 'product', 'profile', 'general')) not null default 'general';`);
    this.addSql(`alter table if exists "album" alter column "description" type text using ("description"::text);`);
    this.addSql(`alter table if exists "album" alter column "description" drop not null;`);
    this.addSql(`alter table if exists "album" alter column "is_public" type boolean using ("is_public"::boolean);`);
    this.addSql(`alter table if exists "album" alter column "is_public" set default true;`);
    this.addSql(`alter table if exists "album" alter column "sort_order" type integer using ("sort_order"::integer);`);
    this.addSql(`alter table if exists "album" alter column "sort_order" set default 0;`);
    this.addSql(`alter table if exists "album" alter column "metadata" type jsonb using ("metadata"::jsonb);`);
    this.addSql(`alter table if exists "album" alter column "metadata" drop not null;`);
    this.addSql(`alter table if exists "album" add constraint "album_cover_media_id_foreign" foreign key ("cover_media_id") references "media_file" ("id") on update cascade;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_album_slug_unique" ON "album" (slug) WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_album_cover_media_id" ON "album" (cover_media_id) WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "folder" drop constraint if exists "folder_parent_folder_id_foreign";`);

    this.addSql(`alter table if exists "media_file" drop constraint if exists "media_file_folder_id_foreign";`);

    this.addSql(`drop table if exists "folder" cascade;`);

    this.addSql(`drop table if exists "album_media" cascade;`);

    this.addSql(`alter table if exists "album" drop constraint if exists "album_cover_media_id_foreign";`);

    this.addSql(`alter table if exists "media_file" drop constraint if exists "media_file_file_type_check";`);

    this.addSql(`drop index if exists "IDX_album_slug_unique";`);
    this.addSql(`drop index if exists "IDX_album_cover_media_id";`);
    this.addSql(`alter table if exists "album" drop column if exists "slug", drop column if exists "type";`);

    this.addSql(`alter table if exists "album" alter column "description" type text using ("description"::text);`);
    this.addSql(`alter table if exists "album" alter column "description" set not null;`);
    this.addSql(`alter table if exists "album" alter column "sort_order" drop default;`);
    this.addSql(`alter table if exists "album" alter column "sort_order" type integer using ("sort_order"::integer);`);
    this.addSql(`alter table if exists "album" alter column "metadata" type jsonb using ("metadata"::jsonb);`);
    this.addSql(`alter table if exists "album" alter column "metadata" set not null;`);

    this.addSql(`drop index if exists "IDX_media_file_folder_id";`);
    this.addSql(`alter table if exists "media_file" drop column if exists "original_name", drop column if exists "file_hash", drop column if exists "extension", drop column if exists "width", drop column if exists "height", drop column if exists "duration", drop column if exists "caption", drop column if exists "folder_path", drop column if exists "folder_id";`);

    this.addSql(`alter table if exists "media_file" alter column "file_type" type text using ("file_type"::text);`);
    this.addSql(`alter table if exists "media_file" alter column "title" type text using ("title"::text);`);
    this.addSql(`alter table if exists "media_file" alter column "title" set not null;`);
    this.addSql(`alter table if exists "media_file" alter column "description" type text using ("description"::text);`);
    this.addSql(`alter table if exists "media_file" alter column "description" set not null;`);
    this.addSql(`alter table if exists "media_file" alter column "alt_text" type text using ("alt_text"::text);`);
    this.addSql(`alter table if exists "media_file" alter column "alt_text" set not null;`);
    this.addSql(`alter table if exists "media_file" alter column "tags" type jsonb using ("tags"::jsonb);`);
    this.addSql(`alter table if exists "media_file" alter column "tags" set not null;`);
    this.addSql(`alter table if exists "media_file" alter column "metadata" type jsonb using ("metadata"::jsonb);`);
    this.addSql(`alter table if exists "media_file" alter column "metadata" set not null;`);
  }

}
