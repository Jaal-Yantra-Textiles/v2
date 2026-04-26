import { Migration } from '@mikro-orm/migrations';

export class Migration20250113165947 extends Migration {

  async up(): Promise<void> {
    this.addSql('create table if not exists "note" ("id" text not null, "entity_id" text not null, "entity_name" text not null, "note" jsonb not null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "note_pkey" primary key ("id"));');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_note_deleted_at" ON "note" (deleted_at) WHERE deleted_at IS NULL;');
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "note" cascade;');
  }

}
