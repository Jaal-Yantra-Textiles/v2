import { Migration } from '@mikro-orm/migrations';

export class Migration20250729143036 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "person_subs" drop constraint if exists "person_subs_person_id_unique";`);
    this.addSql(`create table if not exists "person_subs" ("id" text not null, "subscription_type" text check ("subscription_type" in ('email', 'sms')) not null, "network" text check ("network" in ('cicilabel', 'jaalyantra')) not null, "subscription_status" text check ("subscription_status" in ('active', 'inactive')) not null, "email_subscribed" text not null, "person_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "person_subs_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_person_subs_person_id_unique" ON "person_subs" (person_id) WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_person_subs_deleted_at" ON "person_subs" (deleted_at) WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "person_subs" add constraint "person_subs_person_id_foreign" foreign key ("person_id") references "person" ("id") on update cascade;`);

    this.addSql(`alter table if exists "person" add column if not exists "notes" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "person_subs" cascade;`);

    this.addSql(`alter table if exists "person" drop column if exists "notes";`);
  }

}
