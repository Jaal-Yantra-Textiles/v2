import { Migration } from "@mikro-orm/migrations";

export class Migration20241222102912 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'create table if not exists "person_address" ("id" text not null, "street" text not null, "city" text not null, "state" text not null, "postal_code" text not null, "country" text not null, "person_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "person_address_pkey" primary key ("id"));',
    );
    this.addSql(
      'CREATE INDEX IF NOT EXISTS "IDX_person_address_person_id" ON "person_address" (person_id) WHERE deleted_at IS NULL;',
    );
    this.addSql(
      'CREATE INDEX IF NOT EXISTS "IDX_person_address_deleted_at" ON "person_address" (deleted_at) WHERE deleted_at IS NULL;',
    );

    this.addSql(
      'alter table if exists "person_address" add constraint "person_address_person_id_foreign" foreign key ("person_id") references "person" ("id") on update cascade;',
    );

    this.addSql(
      'alter table if exists "person" add column if not exists "avatar" text;',
    );
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "person_address" cascade;');

    this.addSql(
      'alter table if exists "person" drop column if exists "avatar";',
    );
  }
}
