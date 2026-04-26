import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260323100000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "subscription_send_log" (
      "id" text not null,
      "page_id" text not null,
      "subscriber_id" text not null,
      "subscriber_email" text not null,
      "provider" text null,
      "status" text check ("status" in ('sent', 'failed', 'queued', 'retried')) not null default 'sent',
      "error" text null,
      "sent_at" timestamptz null,
      "metadata" jsonb null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "subscription_send_log_pkey" primary key ("id")
    );`);

    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_subscription_send_log_deleted_at" ON "subscription_send_log" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_subscription_send_log_page_id" ON "subscription_send_log" ("page_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_subscription_send_log_email" ON "subscription_send_log" ("subscriber_email") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_subscription_send_log_status" ON "subscription_send_log" ("status") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table "subscription_send_log" add constraint "subscription_send_log_page_id_foreign" foreign key ("page_id") references "page" ("id") on update cascade on delete cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "subscription_send_log" cascade;`);
  }

}
