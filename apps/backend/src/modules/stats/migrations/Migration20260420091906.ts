import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260420091906 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "stats_dashboard" ("id" text not null, "name" text not null, "description" text null, "icon" text null, "color" text null, "metadata" jsonb not null default '{}', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "stats_dashboard_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_stats_dashboard_deleted_at" ON "stats_dashboard" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_stats_dashboard_name" ON "stats_dashboard" ("name") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "stats_panel" ("id" text not null, "dashboard_id" text not null, "name" text not null, "type" text check ("type" in ('metric', 'list', 'table', 'bar', 'line', 'area', 'label')) not null default 'metric', "x" integer not null default 0, "y" integer not null default 0, "width" integer not null default 4, "height" integer not null default 3, "operation_type" text not null, "operation_options" jsonb not null default '{}', "display" jsonb not null default '{}', "cache_ttl_seconds" integer null, "metadata" jsonb not null default '{}', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "stats_panel_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_stats_panel_dashboard_id" ON "stats_panel" ("dashboard_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_stats_panel_deleted_at" ON "stats_panel" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_stats_panel_operation_type" ON "stats_panel" ("operation_type") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "stats_panel" add constraint "stats_panel_dashboard_id_foreign" foreign key ("dashboard_id") references "stats_dashboard" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "stats_panel" drop constraint if exists "stats_panel_dashboard_id_foreign";`);

    this.addSql(`drop table if exists "stats_dashboard" cascade;`);

    this.addSql(`drop table if exists "stats_panel" cascade;`);
  }

}
