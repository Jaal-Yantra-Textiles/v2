import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20251227230904 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "design_colors" ("id" text not null, "name" text not null, "hex_code" text not null, "usage_notes" text null, "order" integer null, "metadata" jsonb null, "design_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "design_colors_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_design_colors_design_id" ON "design_colors" ("design_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_design_colors_deleted_at" ON "design_colors" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "design_size_sets" ("id" text not null, "size_label" text not null, "measurements" jsonb null, "metadata" jsonb null, "design_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "design_size_sets_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_design_size_sets_design_id" ON "design_size_sets" ("design_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_design_size_sets_deleted_at" ON "design_size_sets" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "design_colors" add constraint "design_colors_design_id_foreign" foreign key ("design_id") references "design" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table if exists "design_size_sets" add constraint "design_size_sets_design_id_foreign" foreign key ("design_id") references "design" ("id") on update cascade on delete cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "design_colors" cascade;`);

    this.addSql(`drop table if exists "design_size_sets" cascade;`);
  }

}
