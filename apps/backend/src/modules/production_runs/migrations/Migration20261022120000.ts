import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * A partner task done for a production run by another partner (a shoot for a
 * weaver's run). Hand-written: one new table, so down() drops only that.
 */
export class Migration20261022120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "production_run_partner_task" ("id" text not null, "production_run_id" text not null, "task_id" text not null, "partner_id" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "production_run_partner_task_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_production_run_partner_task_deleted_at" ON "production_run_partner_task" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_production_run_partner_task_production_run_id" ON "production_run_partner_task" ("production_run_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_production_run_partner_task_task_id_unique" ON "production_run_partner_task" ("task_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "production_run_partner_task" cascade;`);
  }

}
