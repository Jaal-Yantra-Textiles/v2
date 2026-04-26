import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260301090557 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "inbound_email" ("id" text not null, "imap_uid" text not null, "message_id" text null, "from_address" text not null, "to_addresses" jsonb not null, "subject" text not null, "html_body" text not null, "text_body" text null, "folder" text not null, "received_at" timestamptz not null, "status" text check ("status" in ('received', 'action_pending', 'processed', 'ignored')) not null default 'received', "action_type" text null, "action_result" jsonb null, "extracted_data" jsonb null, "error_message" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "inbound_email_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_inbound_email_deleted_at" ON "inbound_email" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "inbound_email" cascade;`);
  }

}
