import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260410065203 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "messaging_conversation" ("id" text not null, "partner_id" text not null, "title" text null, "phone_number" text not null, "last_message_at" timestamptz null, "unread_count" integer not null default 0, "status" text check ("status" in ('active', 'archived')) not null default 'active', "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "messaging_conversation_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_messaging_conversation_deleted_at" ON "messaging_conversation" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "messaging_message" ("id" text not null, "conversation_id" text not null, "direction" text check ("direction" in ('inbound', 'outbound')) not null, "sender_name" text null, "content" text not null, "message_type" text check ("message_type" in ('text', 'interactive', 'template', 'media', 'context_card')) not null default 'text', "wa_message_id" text null, "status" text check ("status" in ('pending', 'sent', 'delivered', 'read', 'failed')) not null default 'sent', "context_type" text null, "context_id" text null, "context_snapshot" jsonb null, "media_url" text null, "media_mime_type" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "messaging_message_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_messaging_message_conversation_id" ON "messaging_message" ("conversation_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_messaging_message_deleted_at" ON "messaging_message" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "messaging_message" add constraint "messaging_message_conversation_id_foreign" foreign key ("conversation_id") references "messaging_conversation" ("id") on update cascade on delete cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "messaging_message" drop constraint if exists "messaging_message_conversation_id_foreign";`);

    this.addSql(`drop table if exists "messaging_conversation" cascade;`);

    this.addSql(`drop table if exists "messaging_message" cascade;`);
  }

}
