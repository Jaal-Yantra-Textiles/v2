import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20251107162710 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "feedback" ("id" text not null, "rating" text check ("rating" in ('one', 'two', 'three', 'four', 'five')) not null default 'three', "comment" text null, "status" text check ("status" in ('pending', 'reviewed', 'resolved')) not null default 'pending', "submitted_by" text not null, "submitted_at" timestamptz not null, "reviewed_by" text null, "reviewed_at" timestamptz null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "feedback_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_feedback_deleted_at" ON "feedback" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "feedback" cascade;`);
  }

}
