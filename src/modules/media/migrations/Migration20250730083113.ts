import { Migration } from '@mikro-orm/migrations';

export class Migration20250730083113 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "media_file" ("id" text not null, "file_name" text not null, "file_path" text not null, "file_size" integer not null, "file_type" text not null, "mime_type" text not null, "alt_text" text not null, "title" text not null, "description" text not null, "metadata" jsonb not null, "tags" jsonb not null, "is_public" boolean not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "media_file_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_media_file_deleted_at" ON "media_file" (deleted_at) WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "media_file" cascade;`);
  }

}
