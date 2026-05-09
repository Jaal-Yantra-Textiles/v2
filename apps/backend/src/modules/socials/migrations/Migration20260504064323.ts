import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260504064323 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "social_platform_binding" ("id" text not null, "service" text check ("service" in ('merchant', 'ads', 'search-console', 'business-profile')) not null, "resource_id" text not null, "resource_label" text null, "status" text check ("status" in ('active', 'paused', 'error', 'pending')) not null default 'active', "last_synced_at" timestamptz null, "last_error" text null, "settings" jsonb null, "metadata" jsonb null, "platform_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "social_platform_binding_pkey" primary key ("id"));`);

    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_social_platform_binding_platform_id" ON "social_platform_binding" ("platform_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_social_platform_binding_deleted_at" ON "social_platform_binding" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_social_platform_binding_platform_id_service_resource_id_unique" ON "social_platform_binding" ("platform_id", "service", "resource_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_social_platform_binding_service_status" ON "social_platform_binding" ("service", "status") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "social_platform_binding" add constraint "social_platform_binding_platform_id_foreign" foreign key ("platform_id") references "social_platform" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "social_platform_binding" cascade;`);
  }

}
