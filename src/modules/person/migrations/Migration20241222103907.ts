import { Migration } from '@mikro-orm/migrations';

export class Migration20241222103907 extends Migration {

  async up(): Promise<void> {
    this.addSql('create table if not exists "contact_detail" ("id" text not null, "phone_number" text not null, "type" text check ("type" in (\'mobile\', \'home\', \'work\')) not null, "person_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "contact_detail_pkey" primary key ("id"));');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_contact_detail_person_id" ON "contact_detail" (person_id) WHERE deleted_at IS NULL;');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_contact_detail_deleted_at" ON "contact_detail" (deleted_at) WHERE deleted_at IS NULL;');

    this.addSql('create table if not exists "tag" ("id" text not null, "name" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "tag_pkey" primary key ("id"));');
    this.addSql('CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tag_name_unique" ON "tag" (name) WHERE deleted_at IS NULL;');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_tag_deleted_at" ON "tag" (deleted_at) WHERE deleted_at IS NULL;');

    this.addSql('create table if not exists "person_tags" ("person_id" text not null, "tag_id" text not null, constraint "person_tags_pkey" primary key ("person_id", "tag_id"));');

    this.addSql('alter table if exists "contact_detail" add constraint "contact_detail_person_id_foreign" foreign key ("person_id") references "person" ("id") on update cascade;');

    this.addSql('alter table if exists "person_tags" add constraint "person_tags_person_id_foreign" foreign key ("person_id") references "person" ("id") on update cascade on delete cascade;');
    this.addSql('alter table if exists "person_tags" add constraint "person_tags_tag_id_foreign" foreign key ("tag_id") references "tag" ("id") on update cascade on delete cascade;');
  }

  async down(): Promise<void> {
    this.addSql('alter table if exists "person_tags" drop constraint if exists "person_tags_tag_id_foreign";');

    this.addSql('drop table if exists "contact_detail" cascade;');

    this.addSql('drop table if exists "tag" cascade;');

    this.addSql('drop table if exists "person_tags" cascade;');
  }

}
