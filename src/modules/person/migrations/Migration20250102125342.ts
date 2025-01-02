import { Migration } from '@mikro-orm/migrations';

export class Migration20250102125342 extends Migration {

  async up(): Promise<void> {
    this.addSql('alter table if exists "person_tags" drop constraint if exists "person_tags_tag_id_foreign";');

    this.addSql('drop table if exists "tag" cascade;');

    this.addSql('alter table if exists "person_tags" drop constraint if exists "person_tags_person_id_foreign";');

    this.addSql('alter table if exists "person_tags" add column if not exists "id" text not null, add column if not exists "name" jsonb null, add column if not exists "persons_id" text not null, add column if not exists "created_at" timestamptz not null default now(), add column if not exists "updated_at" timestamptz not null default now(), add column if not exists "deleted_at" timestamptz null;');
    this.addSql('alter table if exists "person_tags" drop constraint if exists "person_tags_pkey";');
    this.addSql('alter table if exists "person_tags" add constraint "person_tags_persons_id_foreign" foreign key ("persons_id") references "person" ("id") on update cascade;');
    this.addSql('alter table if exists "person_tags" drop column if exists "person_id";');
    this.addSql('alter table if exists "person_tags" drop column if exists "tag_id";');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_person_tags_persons_id" ON "person_tags" (persons_id) WHERE deleted_at IS NULL;');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_person_tags_deleted_at" ON "person_tags" (deleted_at) WHERE deleted_at IS NULL;');
    this.addSql('alter table if exists "person_tags" add constraint "person_tags_pkey" primary key ("id");');
  }

  async down(): Promise<void> {
    this.addSql('create table if not exists "tag" ("id" text not null, "name" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "tag_pkey" primary key ("id"));');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_tag_deleted_at" ON "tag" (deleted_at) WHERE deleted_at IS NULL;');

    this.addSql('alter table if exists "person_tags" drop constraint if exists "person_tags_persons_id_foreign";');

    this.addSql('alter table if exists "person_tags" add column if not exists "person_id" text not null, add column if not exists "tag_id" text not null;');
    this.addSql('drop index if exists "IDX_person_tags_persons_id";');
    this.addSql('drop index if exists "IDX_person_tags_deleted_at";');
    this.addSql('alter table if exists "person_tags" drop constraint if exists "person_tags_pkey";');
    this.addSql('alter table if exists "person_tags" add constraint "person_tags_person_id_foreign" foreign key ("person_id") references "person" ("id") on update cascade on delete cascade;');
    this.addSql('alter table if exists "person_tags" add constraint "person_tags_tag_id_foreign" foreign key ("tag_id") references "tag" ("id") on update cascade on delete cascade;');
    this.addSql('alter table if exists "person_tags" drop column if exists "id";');
    this.addSql('alter table if exists "person_tags" drop column if exists "name";');
    this.addSql('alter table if exists "person_tags" drop column if exists "persons_id";');
    this.addSql('alter table if exists "person_tags" drop column if exists "created_at";');
    this.addSql('alter table if exists "person_tags" drop column if exists "updated_at";');
    this.addSql('alter table if exists "person_tags" drop column if exists "deleted_at";');
    this.addSql('alter table if exists "person_tags" add constraint "person_tags_pkey" primary key ("person_id", "tag_id");');
  }

}
