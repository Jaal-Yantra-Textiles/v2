import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260821102630 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "partner_quote_event" ("id" text not null, "quote_id" text not null, "type" text not null, "actor_type" text not null, "actor_id" text null, "message" text null, "data" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "partner_quote_event_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_partner_quote_event_quote_id" ON "partner_quote_event" ("quote_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_partner_quote_event_deleted_at" ON "partner_quote_event" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "partner_quote_event" add constraint "partner_quote_event_quote_id_foreign" foreign key ("quote_id") references "partner_quote" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "partner_quote_event" cascade;`);
  }

}
