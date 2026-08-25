import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260825011617 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "design_inquiry" ("id" text not null, "design_id" text not null, "title" text not null, "brief_note" text null, "reference_media_ids" jsonb null, "spec_version" text null, "status" text check ("status" in ('open', 'closed')) not null default 'open', "created_by" text null, "closed_at" timestamptz null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "design_inquiry_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_design_inquiry_deleted_at" ON "design_inquiry" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_design_inquiry_design" ON "design_inquiry" ("design_id") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "design_inquiry_question" ("id" text not null, "inquiry_id" text not null, "step" text not null, "order" integer not null default 0, "kind" text check ("kind" in ('yes_no', 'colour_select', 'number', 'text', 'photo')) not null default 'yes_no', "prompt" text not null, "options" jsonb null, "spec_field_ref" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "design_inquiry_question_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_design_inquiry_question_inquiry_id" ON "design_inquiry_question" ("inquiry_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_design_inquiry_question_deleted_at" ON "design_inquiry_question" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_design_inquiry_question_inquiry" ON "design_inquiry_question" ("inquiry_id") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "design_inquiry_response" ("id" text not null, "inquiry_id" text not null, "partner_id" text not null, "verdict" text check ("verdict" in ('can_make', 'cannot_make', 'with_changes')) null, "lead_time_days" integer null, "indicative_price" numeric null, "currency_code" text null, "notes" text null, "channel" text check ("channel" in ('wizard', 'assistant', 'whatsapp', 'admin')) not null default 'wizard', "invited_at" timestamptz null, "submitted_at" timestamptz null, "metadata" jsonb null, "raw_indicative_price" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "design_inquiry_response_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_design_inquiry_response_inquiry_id" ON "design_inquiry_response" ("inquiry_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_design_inquiry_response_deleted_at" ON "design_inquiry_response" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_design_inquiry_response_inquiry" ON "design_inquiry_response" ("inquiry_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_design_inquiry_response_partner" ON "design_inquiry_response" ("partner_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "uniq_design_inquiry_response_partner" ON "design_inquiry_response" ("inquiry_id", "partner_id") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "design_inquiry_answer" ("id" text not null, "response_id" text not null, "question_id" text not null, "value" jsonb null, "note" text null, "capability_sample_ids" jsonb null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "design_inquiry_answer_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_design_inquiry_answer_response_id" ON "design_inquiry_answer" ("response_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_design_inquiry_answer_deleted_at" ON "design_inquiry_answer" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_design_inquiry_answer_response" ON "design_inquiry_answer" ("response_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "uniq_design_inquiry_answer_question" ON "design_inquiry_answer" ("response_id", "question_id") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "design_inquiry_question" add constraint "design_inquiry_question_inquiry_id_foreign" foreign key ("inquiry_id") references "design_inquiry" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table if exists "design_inquiry_response" add constraint "design_inquiry_response_inquiry_id_foreign" foreign key ("inquiry_id") references "design_inquiry" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table if exists "design_inquiry_answer" add constraint "design_inquiry_answer_response_id_foreign" foreign key ("response_id") references "design_inquiry_response" ("id") on update cascade on delete cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "design_inquiry_question" drop constraint if exists "design_inquiry_question_inquiry_id_foreign";`);

    this.addSql(`alter table if exists "design_inquiry_response" drop constraint if exists "design_inquiry_response_inquiry_id_foreign";`);

    this.addSql(`alter table if exists "design_inquiry_answer" drop constraint if exists "design_inquiry_answer_response_id_foreign";`);

    this.addSql(`drop table if exists "design_inquiry" cascade;`);

    this.addSql(`drop table if exists "design_inquiry_question" cascade;`);

    this.addSql(`drop table if exists "design_inquiry_response" cascade;`);

    this.addSql(`drop table if exists "design_inquiry_answer" cascade;`);
  }

}
