import { Migration } from '@mikro-orm/migrations';

export class Migration20250724151232 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "agreement" ("id" text not null, "title" text not null, "content" text not null, "template_key" text null, "status" text check ("status" in ('draft', 'active', 'expired', 'cancelled')) not null default 'draft', "valid_from" timestamptz null, "valid_until" timestamptz null, "subject" text not null default 'Agreement for Review', "from_email" text null, "sent_count" integer not null default 0, "response_count" integer not null default 0, "agreed_count" integer not null default 0, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "agreement_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_agreement_deleted_at" ON "agreement" (deleted_at) WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "agreement_response" ("id" text not null, "status" text check ("status" in ('sent', 'viewed', 'agreed', 'disagreed', 'expired')) not null default 'sent', "sent_at" timestamptz not null, "viewed_at" timestamptz null, "responded_at" timestamptz null, "agreed" boolean null, "response_notes" text null, "email_sent_to" text not null, "email_opened" boolean not null default false, "email_opened_at" timestamptz null, "response_ip" text null, "response_user_agent" text null, "metadata" jsonb null, "agreement_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "agreement_response_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_agreement_response_agreement_id" ON "agreement_response" (agreement_id) WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_agreement_response_deleted_at" ON "agreement_response" (deleted_at) WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "agreement_response" add constraint "agreement_response_agreement_id_foreign" foreign key ("agreement_id") references "agreement" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "agreement_response" drop constraint if exists "agreement_response_agreement_id_foreign";`);

    this.addSql(`drop table if exists "agreement" cascade;`);

    this.addSql(`drop table if exists "agreement_response" cascade;`);
  }

}
