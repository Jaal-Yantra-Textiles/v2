import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20251207075552 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "lead" drop constraint if exists "lead_lead_form_id_foreign";`);
    this.addSql(`alter table if exists "lead" drop constraint if exists "lead_platform_id_foreign";`);

    this.addSql(`alter table if exists "lead" alter column "lead_form_id" type text using ("lead_form_id"::text);`);
    this.addSql(`alter table if exists "lead" alter column "lead_form_id" drop not null;`);
    this.addSql(`alter table if exists "lead" alter column "platform_id" type text using ("platform_id"::text);`);
    this.addSql(`alter table if exists "lead" alter column "platform_id" drop not null;`);
    this.addSql(`alter table if exists "lead" add constraint "lead_lead_form_id_foreign" foreign key ("lead_form_id") references "lead_form" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table if exists "lead" add constraint "lead_platform_id_foreign" foreign key ("platform_id") references "social_platform" ("id") on update cascade on delete set null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "lead" drop constraint if exists "lead_lead_form_id_foreign";`);
    this.addSql(`alter table if exists "lead" drop constraint if exists "lead_platform_id_foreign";`);

    this.addSql(`alter table if exists "lead" alter column "lead_form_id" type text using ("lead_form_id"::text);`);
    this.addSql(`alter table if exists "lead" alter column "lead_form_id" set not null;`);
    this.addSql(`alter table if exists "lead" alter column "platform_id" type text using ("platform_id"::text);`);
    this.addSql(`alter table if exists "lead" alter column "platform_id" set not null;`);
    this.addSql(`alter table if exists "lead" add constraint "lead_lead_form_id_foreign" foreign key ("lead_form_id") references "lead_form" ("id") on update cascade;`);
    this.addSql(`alter table if exists "lead" add constraint "lead_platform_id_foreign" foreign key ("platform_id") references "social_platform" ("id") on update cascade;`);
  }

}
