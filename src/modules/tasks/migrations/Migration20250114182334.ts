import { Migration } from '@mikro-orm/migrations';

export class Migration20250114182334 extends Migration {

  async up(): Promise<void> {
    this.addSql('create table if not exists "task" ("id" text not null, "title" text not null, "description" text null, "start_date" timestamptz not null, "end_date" timestamptz null, "status" text check ("status" in (\'pending\', \'in_progress\', \'completed\', \'cancelled\')) not null default \'pending\', "priority" text check ("priority" in (\'low\', \'medium\', \'high\')) not null default \'medium\', "eventable" boolean not null default false, "notifiable" boolean not null default false, "message" text null, "assigned_to" text null, "assigned_by" text null, "metadata" jsonb null, "completed_at" timestamptz null, "parent_task_id" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "task_pkey" primary key ("id"));');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_task_parent_task_id" ON "task" (parent_task_id) WHERE deleted_at IS NULL;');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_task_deleted_at" ON "task" (deleted_at) WHERE deleted_at IS NULL;');

    this.addSql('create table if not exists "task_category" ("id" text not null, "name" text not null, "description" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "task_category_pkey" primary key ("id"));');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_task_category_deleted_at" ON "task_category" (deleted_at) WHERE deleted_at IS NULL;');

    this.addSql('create table if not exists "task_dependency" ("id" text not null, "dependency_type" text check ("dependency_type" in (\'blocking\', \'related\', \'subtask\')) not null default \'blocking\', "metadata" jsonb null, "source_task_id" text not null, "target_task_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "task_dependency_pkey" primary key ("id"));');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_task_dependency_source_task_id" ON "task_dependency" (source_task_id) WHERE deleted_at IS NULL;');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_task_dependency_target_task_id" ON "task_dependency" (target_task_id) WHERE deleted_at IS NULL;');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_task_dependency_deleted_at" ON "task_dependency" (deleted_at) WHERE deleted_at IS NULL;');

    this.addSql('create table if not exists "task_template" ("id" text not null, "name" text not null, "description" text not null, "category_id" text null, "estimated_duration" integer null, "priority" text check ("priority" in (\'low\', \'medium\', \'high\')) not null default \'medium\', "required_fields" jsonb null, "eventable" boolean not null default false, "notifiable" boolean not null default false, "message_template" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "task_template_pkey" primary key ("id"));');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_task_template_category_id" ON "task_template" (category_id) WHERE deleted_at IS NULL;');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_task_template_deleted_at" ON "task_template" (deleted_at) WHERE deleted_at IS NULL;');

    this.addSql('alter table if exists "task" add constraint "task_parent_task_id_foreign" foreign key ("parent_task_id") references "task" ("id") on update cascade on delete set null;');

    this.addSql('alter table if exists "task_dependency" add constraint "task_dependency_source_task_id_foreign" foreign key ("source_task_id") references "task" ("id") on update cascade;');
    this.addSql('alter table if exists "task_dependency" add constraint "task_dependency_target_task_id_foreign" foreign key ("target_task_id") references "task" ("id") on update cascade;');

    this.addSql('alter table if exists "task_template" add constraint "task_template_category_id_foreign" foreign key ("category_id") references "task_category" ("id") on update cascade on delete set null;');
  }

  async down(): Promise<void> {
    this.addSql('alter table if exists "task" drop constraint if exists "task_parent_task_id_foreign";');

    this.addSql('alter table if exists "task_dependency" drop constraint if exists "task_dependency_source_task_id_foreign";');

    this.addSql('alter table if exists "task_dependency" drop constraint if exists "task_dependency_target_task_id_foreign";');

    this.addSql('alter table if exists "task_template" drop constraint if exists "task_template_category_id_foreign";');

    this.addSql('drop table if exists "task" cascade;');

    this.addSql('drop table if exists "task_category" cascade;');

    this.addSql('drop table if exists "task_dependency" cascade;');

    this.addSql('drop table if exists "task_template" cascade;');
  }

}
