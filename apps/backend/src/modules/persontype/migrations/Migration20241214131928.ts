import { Migration } from '@mikro-orm/migrations';

export class Migration20241214131928 extends Migration {

  async up(): Promise<void> {
    this.addSql('create table if not exists "person_type" ("id" text not null, "name" text not null, "description" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "person_type_pkey" primary key ("id"));');
    this.addSql('CREATE UNIQUE INDEX IF NOT EXISTS "IDX_person_type_name_unique" ON "person_type" (name) WHERE deleted_at IS NULL;');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_person_type_deleted_at" ON "person_type" (deleted_at) WHERE deleted_at IS NULL;');
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "person_type" cascade;');
  }

}
