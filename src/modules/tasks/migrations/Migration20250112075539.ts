import { Migration } from '@mikro-orm/migrations';

export class Migration20250112075539 extends Migration {

  async up(): Promise<void> {
    this.addSql('create table if not exists "task" ("id" text not null, "title" text not null, "description" text null, "start_date" timestamptz not null, "end_date" timestamptz not null, "status" text check ("status" in (\'pending\', \'in_progress\', \'completed\', \'cancelled\')) not null default \'pending\', "priority" text check ("priority" in (\'low\', \'medium\', \'high\')) not null default \'medium\', "eventable" boolean not null default false, "notifiable" boolean not null default false, "message" text null, "assigned_to" text null, "assigned_by" text null, "metadata" jsonb null, "completed_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "task_pkey" primary key ("id"));');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_task_deleted_at" ON "task" (deleted_at) WHERE deleted_at IS NULL;');

    this.addSql('create table if not exists "task_category" ("id" text not null, "name" text not null, "description" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "task_category_pkey" primary key ("id"));');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_task_category_deleted_at" ON "task_category" (deleted_at) WHERE deleted_at IS NULL;');

    this.addSql('create table if not exists "task_template" ("id" text not null, "name" text not null, "description" text not null, "category_id" text not null, "estimated_duration" integer null, "priority" text check ("priority" in (\'low\', \'medium\', \'high\')) not null default \'medium\', "required_fields" jsonb null, "eventable" boolean not null default false, "notifiable" boolean not null default false, "message_template" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "task_template_pkey" primary key ("id"));');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_task_template_category_id" ON "task_template" (category_id) WHERE deleted_at IS NULL;');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_task_template_deleted_at" ON "task_template" (deleted_at) WHERE deleted_at IS NULL;');

    this.addSql('alter table if exists "task_template" add constraint "task_template_category_id_foreign" foreign key ("category_id") references "task_category" ("id") on update cascade;');
  }

  async down(): Promise<void> {
    this.addSql('alter table if exists "task_template" drop constraint if exists "task_template_category_id_foreign";');

    this.addSql('drop table if exists "task" cascade;');

    this.addSql('drop table if exists "task_category" cascade;');

    this.addSql('drop table if exists "task_template" cascade;');
  }

}