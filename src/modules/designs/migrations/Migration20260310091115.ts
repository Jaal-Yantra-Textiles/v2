import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260310091115 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "design_component" ("id" text not null, "quantity" integer not null default 1, "role" text null, "notes" text null, "order" integer not null default 0, "metadata" jsonb null, "parent_design_id" text not null, "component_design_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "design_component_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_design_component_parent_design_id" ON "design_component" ("parent_design_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_design_component_component_design_id" ON "design_component" ("component_design_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_design_component_deleted_at" ON "design_component" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "design_component" add constraint "design_component_parent_design_id_foreign" foreign key ("parent_design_id") references "design" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table if exists "design_component" add constraint "design_component_component_design_id_foreign" foreign key ("component_design_id") references "design" ("id") on update cascade on delete cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "design_component" cascade;`);
  }

}
