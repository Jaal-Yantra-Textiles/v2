import { Migration } from '@mikro-orm/migrations';

export class Migration20241212072911 extends Migration {

  async up(): Promise<void> {
    this.addSql('create table if not exists "person" ("id" text not null, "first_name" text not null, "last_name" text not null, "email" text not null, "date_of_birth" timestamptz null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "person_pkey" primary key ("id"));');
    this.addSql('CREATE UNIQUE INDEX IF NOT EXISTS "IDX_person_email_unique" ON "person" (email) WHERE deleted_at IS NULL;');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_person_deleted_at" ON "person" (deleted_at) WHERE deleted_at IS NULL;');
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "person" cascade;');
  }

}
