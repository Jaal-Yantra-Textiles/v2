import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260102021327 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "form" drop constraint if exists "form_domain_handle_unique";`);
    this.addSql(`alter table if exists "form" drop constraint if exists "form_handle_website_id_unique";`);
    this.addSql(`create table if not exists "form" ("id" text not null, "website_id" text null, "domain" text null, "handle" text not null, "title" text not null, "description" text null, "status" text check ("status" in ('draft', 'published', 'archived')) not null default 'draft', "submit_label" text null, "success_message" text null, "settings" jsonb null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "form_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_form_deleted_at" ON "form" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_form_handle_website_id_unique" ON "form" ("handle", "website_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_form_domain_handle_unique" ON "form" ("domain", "handle") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_form_domain" ON "form" ("domain") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_form_website_id" ON "form" ("website_id") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "form_field" ("id" text not null, "form_id" text not null, "name" text not null, "label" text not null, "type" text check ("type" in ('text', 'email', 'textarea', 'number', 'select', 'checkbox', 'radio', 'date', 'phone', 'url')) not null default 'text', "required" boolean not null default false, "placeholder" text null, "help_text" text null, "options" jsonb null, "validation" jsonb null, "order" integer not null default 0, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "form_field_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_form_field_form_id" ON "form_field" ("form_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_form_field_deleted_at" ON "form_field" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "form_response" ("id" text not null, "form_id" text not null, "status" text check ("status" in ('new', 'read', 'archived')) not null default 'new', "email" text null, "data" jsonb not null, "submitted_at" timestamptz not null, "page_url" text null, "referrer" text null, "ip" text null, "user_agent" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "form_response_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_form_response_form_id" ON "form_response" ("form_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_form_response_deleted_at" ON "form_response" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_form_response_email" ON "form_response" ("email") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_form_response_submitted_at" ON "form_response" ("submitted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_form_response_status" ON "form_response" ("status") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "form_field" add constraint "form_field_form_id_foreign" foreign key ("form_id") references "form" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table if exists "form_response" add constraint "form_response_form_id_foreign" foreign key ("form_id") references "form" ("id") on update cascade on delete cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "form_field" drop constraint if exists "form_field_form_id_foreign";`);

    this.addSql(`alter table if exists "form_response" drop constraint if exists "form_response_form_id_foreign";`);

    this.addSql(`drop table if exists "form" cascade;`);

    this.addSql(`drop table if exists "form_field" cascade;`);

    this.addSql(`drop table if exists "form_response" cascade;`);
  }

}
