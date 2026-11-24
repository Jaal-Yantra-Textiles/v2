import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/** #2608 S1 — quote briefs: options → steps → partner choices, buyer questions, updates. */
export class Migration20261125090000 extends Migration {

  override async up(): Promise<void> {
    const ts = `"created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null`;

    this.addSql(`create table if not exists "partner_quote_brief" ("id" text not null, "partner_id" text not null, "store_id" text not null, "customer_id" text null, "buyer_email" text null, "recipient_name" text null, "recipient_company" text null, "destination_country_code" text not null, "title" text not null, "intro" text null, "currency_code" text not null default 'inr', "sample_quantity" integer null, "status" text check ("status" in ('draft', 'open', 'submitted', 'sampling', 'quoted', 'closed')) not null default 'draft', "token_hash" text null, "opened_at" timestamptz null, "submitted_at" timestamptz null, "expires_at" timestamptz null, "last_viewed_at" timestamptz null, "view_count" integer not null default 0, "quote_id" text null, "created_by" text null, "metadata" jsonb null, ${ts}, constraint "partner_quote_brief_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_partner_quote_brief_token_hash_unique" ON "partner_quote_brief" ("token_hash") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_partner_quote_brief_partner_id" ON "partner_quote_brief" ("partner_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_partner_quote_brief_deleted_at" ON "partner_quote_brief" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "partner_quote_brief_option" ("id" text not null, "brief_id" text not null, "title" text not null, "description" text null, "position" integer not null default 0, "buyer_selected" boolean not null default false, ${ts}, constraint "partner_quote_brief_option_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_partner_quote_brief_option_brief_id" ON "partner_quote_brief_option" ("brief_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_partner_quote_brief_option_deleted_at" ON "partner_quote_brief_option" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "partner_quote_brief_step" ("id" text not null, "option_id" text not null, "position" integer not null default 0, "label" text not null, "kind" text check ("kind" in ('fabric', 'process')) not null default 'process', "technique" text null, "qty_per_piece" real null, "note" text null, "selected_choice_id" text null, ${ts}, constraint "partner_quote_brief_step_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_partner_quote_brief_step_option_id" ON "partner_quote_brief_step" ("option_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_partner_quote_brief_step_deleted_at" ON "partner_quote_brief_step" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "partner_quote_brief_choice" ("id" text not null, "step_id" text not null, "partner_id" text not null, "rate_id" text null, "sample_ids" jsonb null, "note" text null, "position" integer not null default 0, ${ts}, constraint "partner_quote_brief_choice_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_partner_quote_brief_choice_step_id" ON "partner_quote_brief_choice" ("step_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_partner_quote_brief_choice_deleted_at" ON "partner_quote_brief_choice" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "partner_quote_brief_question" ("id" text not null, "brief_id" text not null, "key" text not null, "label" text not null, "help" text null, "kind" text check ("kind" in ('text', 'long_text', 'number', 'choice', 'multi_choice', 'date', 'boolean', 'link')) not null default 'text', "options" jsonb null, "required" boolean not null default false, "position" integer not null default 0, "answer" jsonb null, "answered_at" timestamptz null, ${ts}, constraint "partner_quote_brief_question_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_partner_quote_brief_question_brief_id" ON "partner_quote_brief_question" ("brief_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_partner_quote_brief_question_deleted_at" ON "partner_quote_brief_question" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "partner_quote_brief_update" ("id" text not null, "brief_id" text not null, "kind" text check ("kind" in ('note', 'sample', 'price')) not null default 'note', "message" text not null, "media_urls" jsonb null, "actor_type" text not null default 'admin', "actor_id" text null, ${ts}, constraint "partner_quote_brief_update_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_partner_quote_brief_update_brief_id" ON "partner_quote_brief_update" ("brief_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_partner_quote_brief_update_deleted_at" ON "partner_quote_brief_update" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "partner_quote_brief_option" add constraint "partner_quote_brief_option_brief_id_foreign" foreign key ("brief_id") references "partner_quote_brief" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table if exists "partner_quote_brief_step" add constraint "partner_quote_brief_step_option_id_foreign" foreign key ("option_id") references "partner_quote_brief_option" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table if exists "partner_quote_brief_choice" add constraint "partner_quote_brief_choice_step_id_foreign" foreign key ("step_id") references "partner_quote_brief_step" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table if exists "partner_quote_brief_question" add constraint "partner_quote_brief_question_brief_id_foreign" foreign key ("brief_id") references "partner_quote_brief" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table if exists "partner_quote_brief_update" add constraint "partner_quote_brief_update_brief_id_foreign" foreign key ("brief_id") references "partner_quote_brief" ("id") on update cascade on delete cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "partner_quote_brief_choice" cascade;`);
    this.addSql(`drop table if exists "partner_quote_brief_step" cascade;`);
    this.addSql(`drop table if exists "partner_quote_brief_option" cascade;`);
    this.addSql(`drop table if exists "partner_quote_brief_question" cascade;`);
    this.addSql(`drop table if exists "partner_quote_brief_update" cascade;`);
    this.addSql(`drop table if exists "partner_quote_brief" cascade;`);
  }

}
