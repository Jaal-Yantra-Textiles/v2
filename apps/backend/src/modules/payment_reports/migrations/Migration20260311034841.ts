import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260311034841 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "payment_report" drop constraint if exists "payment_report_entity_type_check";`);

    this.addSql(`alter table if exists "payment_report" add column if not exists "name" text null, add column if not exists "by_month" jsonb null;`);
    this.addSql(`alter table if exists "payment_report" alter column "entity_type" type text using ("entity_type"::text);`);
    this.addSql(`alter table if exists "payment_report" alter column "entity_type" set default 'all';`);
    this.addSql(`alter table if exists "payment_report" alter column "entity_id" type text using ("entity_id"::text);`);
    this.addSql(`alter table if exists "payment_report" alter column "entity_id" drop not null;`);
    this.addSql(`alter table if exists "payment_report" alter column "filters" type jsonb using ("filters"::jsonb);`);
    this.addSql(`alter table if exists "payment_report" alter column "filters" drop not null;`);
    this.addSql(`alter table if exists "payment_report" alter column "metadata" type jsonb using ("metadata"::jsonb);`);
    this.addSql(`alter table if exists "payment_report" alter column "metadata" drop not null;`);
    this.addSql(`alter table if exists "payment_report" add constraint "payment_report_entity_type_check" check("entity_type" in ('all', 'partner', 'person'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "payment_report" drop constraint if exists "payment_report_entity_type_check";`);

    this.addSql(`alter table if exists "payment_report" drop column if exists "name", drop column if exists "by_month";`);

    this.addSql(`alter table if exists "payment_report" alter column "entity_type" drop default;`);
    this.addSql(`alter table if exists "payment_report" alter column "entity_type" type text using ("entity_type"::text);`);
    this.addSql(`alter table if exists "payment_report" alter column "entity_id" type text using ("entity_id"::text);`);
    this.addSql(`alter table if exists "payment_report" alter column "entity_id" set not null;`);
    this.addSql(`alter table if exists "payment_report" alter column "filters" type jsonb using ("filters"::jsonb);`);
    this.addSql(`alter table if exists "payment_report" alter column "filters" set not null;`);
    this.addSql(`alter table if exists "payment_report" alter column "metadata" type jsonb using ("metadata"::jsonb);`);
    this.addSql(`alter table if exists "payment_report" alter column "metadata" set not null;`);
    this.addSql(`alter table if exists "payment_report" add constraint "payment_report_entity_type_check" check("entity_type" in ('partner', 'person', 'all'));`);
  }

}
