import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20251208044505 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "visual_flow" ("id" text not null, "name" text not null, "description" text null, "status" text check ("status" in ('active', 'inactive', 'draft')) not null default 'draft', "icon" text null, "color" text null, "trigger_type" text check ("trigger_type" in ('event', 'schedule', 'webhook', 'manual', 'another_flow')) not null, "trigger_config" jsonb not null default '{}', "canvas_state" jsonb not null default '{"nodes":[],"edges":[],"viewport":{"x":0,"y":0,"zoom":1}}', "metadata" jsonb not null default '{}', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "visual_flow_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_visual_flow_deleted_at" ON "visual_flow" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_visual_flow_status" ON "visual_flow" ("status") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_visual_flow_trigger_type" ON "visual_flow" ("trigger_type") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "visual_flow_connection" ("id" text not null, "flow_id" text not null, "source_id" text not null, "source_handle" text not null default 'default', "target_id" text not null, "target_handle" text not null default 'default', "connection_type" text check ("connection_type" in ('success', 'failure', 'default')) not null default 'default', "condition" jsonb null, "label" text null, "style" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "visual_flow_connection_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_visual_flow_connection_flow_id" ON "visual_flow_connection" ("flow_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_visual_flow_connection_deleted_at" ON "visual_flow_connection" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_vf_connection_source" ON "visual_flow_connection" ("source_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_vf_connection_target" ON "visual_flow_connection" ("target_id") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "visual_flow_execution" ("id" text not null, "flow_id" text not null, "status" text check ("status" in ('pending', 'running', 'completed', 'failed', 'cancelled')) not null default 'pending', "trigger_data" jsonb not null default '{}', "data_chain" jsonb not null default '{}', "started_at" timestamptz null, "completed_at" timestamptz null, "error" text null, "error_details" jsonb null, "triggered_by" text null, "metadata" jsonb not null default '{}', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "visual_flow_execution_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_visual_flow_execution_flow_id" ON "visual_flow_execution" ("flow_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_visual_flow_execution_deleted_at" ON "visual_flow_execution" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_vf_execution_status" ON "visual_flow_execution" ("status") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_vf_execution_started" ON "visual_flow_execution" ("started_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "visual_flow_operation" ("id" text not null, "flow_id" text not null, "operation_key" text not null, "operation_type" text check ("operation_type" in ('condition', 'create_data', 'read_data', 'update_data', 'delete_data', 'http_request', 'run_script', 'send_email', 'notification', 'transform', 'trigger_workflow', 'sleep', 'log')) not null, "name" text null, "options" jsonb not null default '{}', "position_x" real not null default 0, "position_y" real not null default 0, "sort_order" integer not null default 0, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "visual_flow_operation_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_visual_flow_operation_flow_id" ON "visual_flow_operation" ("flow_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_visual_flow_operation_deleted_at" ON "visual_flow_operation" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_vf_operation_key" ON "visual_flow_operation" ("operation_key") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_vf_operation_type" ON "visual_flow_operation" ("operation_type") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "visual_flow_execution_log" ("id" text not null, "execution_id" text not null, "operation_id" text null, "operation_key" text not null, "status" text check ("status" in ('success', 'failure', 'skipped', 'running')) not null, "input_data" jsonb null, "output_data" jsonb null, "error" text null, "error_stack" text null, "duration_ms" integer null, "executed_at" timestamptz not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "visual_flow_execution_log_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_visual_flow_execution_log_execution_id" ON "visual_flow_execution_log" ("execution_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_visual_flow_execution_log_operation_id" ON "visual_flow_execution_log" ("operation_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_visual_flow_execution_log_deleted_at" ON "visual_flow_execution_log" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_vf_log_operation_key" ON "visual_flow_execution_log" ("operation_key") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_vf_log_status" ON "visual_flow_execution_log" ("status") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_vf_log_executed_at" ON "visual_flow_execution_log" ("executed_at") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "visual_flow_connection" add constraint "visual_flow_connection_flow_id_foreign" foreign key ("flow_id") references "visual_flow" ("id") on update cascade;`);

    this.addSql(`alter table if exists "visual_flow_execution" add constraint "visual_flow_execution_flow_id_foreign" foreign key ("flow_id") references "visual_flow" ("id") on update cascade;`);

    this.addSql(`alter table if exists "visual_flow_operation" add constraint "visual_flow_operation_flow_id_foreign" foreign key ("flow_id") references "visual_flow" ("id") on update cascade;`);

    this.addSql(`alter table if exists "visual_flow_execution_log" add constraint "visual_flow_execution_log_execution_id_foreign" foreign key ("execution_id") references "visual_flow_execution" ("id") on update cascade;`);
    this.addSql(`alter table if exists "visual_flow_execution_log" add constraint "visual_flow_execution_log_operation_id_foreign" foreign key ("operation_id") references "visual_flow_operation" ("id") on update cascade on delete set null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "visual_flow_connection" drop constraint if exists "visual_flow_connection_flow_id_foreign";`);

    this.addSql(`alter table if exists "visual_flow_execution" drop constraint if exists "visual_flow_execution_flow_id_foreign";`);

    this.addSql(`alter table if exists "visual_flow_operation" drop constraint if exists "visual_flow_operation_flow_id_foreign";`);

    this.addSql(`alter table if exists "visual_flow_execution_log" drop constraint if exists "visual_flow_execution_log_execution_id_foreign";`);

    this.addSql(`alter table if exists "visual_flow_execution_log" drop constraint if exists "visual_flow_execution_log_operation_id_foreign";`);

    this.addSql(`drop table if exists "visual_flow" cascade;`);

    this.addSql(`drop table if exists "visual_flow_connection" cascade;`);

    this.addSql(`drop table if exists "visual_flow_execution" cascade;`);

    this.addSql(`drop table if exists "visual_flow_operation" cascade;`);

    this.addSql(`drop table if exists "visual_flow_execution_log" cascade;`);
  }

}
