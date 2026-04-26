import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260414104644 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "consumption_log" ("id" text not null, "design_id" text not null, "production_run_id" text null, "inventory_item_id" text not null, "raw_material_id" text null, "quantity" real not null, "unit_cost" real null, "unit_of_measure" text check ("unit_of_measure" in ('Meter', 'Yard', 'Kilogram', 'Gram', 'Piece', 'Roll', 'kWh', 'Liter', 'Cubic_Meter', 'Hour', 'Other')) not null default 'Other', "consumption_type" text check ("consumption_type" in ('sample', 'production', 'wastage', 'energy_electricity', 'energy_water', 'energy_gas', 'labor')) not null default 'sample', "is_committed" boolean not null default false, "consumed_by" text check ("consumed_by" in ('admin', 'partner')) not null default 'admin', "consumed_at" timestamptz not null, "notes" text null, "location_id" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "consumption_log_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_consumption_log_deleted_at" ON "consumption_log" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "consumption_log" cascade;`);
  }

}
