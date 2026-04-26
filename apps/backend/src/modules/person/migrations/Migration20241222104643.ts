import { Migration } from '@mikro-orm/migrations';

export class Migration20241222104643 extends Migration {

  async up(): Promise<void> {
    this.addSql('create table if not exists "person_contact_detail" ("id" text not null, "phone_number" text not null, "type" text check ("type" in (\'mobile\', \'home\', \'work\')) not null, "person_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "person_contact_detail_pkey" primary key ("id"));');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_person_contact_detail_person_id" ON "person_contact_detail" (person_id) WHERE deleted_at IS NULL;');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_person_contact_detail_deleted_at" ON "person_contact_detail" (deleted_at) WHERE deleted_at IS NULL;');

    this.addSql('alter table if exists "person_contact_detail" add constraint "person_contact_detail_person_id_foreign" foreign key ("person_id") references "person" ("id") on update cascade;');

    this.addSql('drop table if exists "contact_detail" cascade;');
  }

  async down(): Promise<void> {
    this.addSql('create table if not exists "contact_detail" ("id" text not null, "phone_number" text not null, "type" text check ("type" in (\'mobile\', \'home\', \'work\')) not null, "person_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "contact_detail_pkey" primary key ("id"));');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_contact_detail_person_id" ON "contact_detail" (person_id) WHERE deleted_at IS NULL;');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_contact_detail_deleted_at" ON "contact_detail" (deleted_at) WHERE deleted_at IS NULL;');

    this.addSql('alter table if exists "contact_detail" add constraint "contact_detail_person_id_foreign" foreign key ("person_id") references "person" ("id") on update cascade;');

    this.addSql('drop table if exists "person_contact_detail" cascade;');
  }

}
