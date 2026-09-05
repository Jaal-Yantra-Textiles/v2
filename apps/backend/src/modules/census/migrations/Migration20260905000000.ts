import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Census unmask audit — the one Postgres table in the census module. Records
 * each admin reveal of a weaver's full (sensitive-core) PII: who asked, which
 * census_id, and which sensitive keys came back. Queryable + durable, independent
 * of the P2P core.
 */
export class Migration20260905000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table if not exists "census_unmask_audit" ("id" text not null, "census_id" text not null, "actor_id" text null, "fields" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "census_unmask_audit_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_census_unmask_audit_deleted_at" ON "census_unmask_audit" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "census_unmask_audit" cascade;`);
  }
}