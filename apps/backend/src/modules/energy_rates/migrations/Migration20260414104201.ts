import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260414104201 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "energy_rate" ("id" text not null, "name" text not null, "energy_type" text check ("energy_type" in ('energy_electricity', 'energy_water', 'energy_gas', 'labor')) not null, "unit_of_measure" text check ("unit_of_measure" in ('kWh', 'Liter', 'Cubic_Meter', 'Hour', 'Other')) not null default 'Other', "rate_per_unit" real not null, "currency" text not null default 'inr', "effective_from" timestamptz not null, "effective_to" timestamptz null, "region" text null, "is_active" boolean not null default true, "notes" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "energy_rate_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_energy_rate_deleted_at" ON "energy_rate" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "energy_rate" cascade;`);
  }

}
