import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260411051630 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "media_comment" ("id" text not null, "content" text not null, "author_type" text check ("author_type" in ('partner', 'admin')) not null, "author_id" text not null, "author_name" text not null, "media_file_id" text not null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "media_comment_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_media_comment_media_file_id" ON "media_comment" ("media_file_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_media_comment_deleted_at" ON "media_comment" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "media_comment" add constraint "media_comment_media_file_id_foreign" foreign key ("media_file_id") references "media_file" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "media_comment" cascade;`);
  }

}
