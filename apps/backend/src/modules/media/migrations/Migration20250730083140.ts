import { Migration } from '@mikro-orm/migrations';

export class Migration20250730083140 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "album" ("id" text not null, "name" text not null, "description" text not null, "cover_media_id" text not null, "is_public" boolean not null, "sort_order" integer not null, "metadata" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "album_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_album_deleted_at" ON "album" (deleted_at) WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "album" cascade;`);
  }

}
