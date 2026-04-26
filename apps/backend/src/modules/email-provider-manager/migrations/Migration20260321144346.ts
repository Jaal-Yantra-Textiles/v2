import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260321144346 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "email_usage" ("id" text not null, "provider" text not null, "date" text not null, "count" integer not null default 0, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "email_usage_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_email_usage_deleted_at" ON "email_usage" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "email_usage" cascade;`);
  }

}
