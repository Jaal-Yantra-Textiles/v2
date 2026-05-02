import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260501155350 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "form" add column if not exists "type" text not null default 'generic';`);
    this.addSql(`alter table if exists "form" add constraint "form_type_check" check("type" in ('generic', 'tour'));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_form_type" ON "form" ("type") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_form_type";`);
    this.addSql(`alter table if exists "form" drop constraint if exists "form_type_check";`);
    this.addSql(`alter table if exists "form" drop column if exists "type";`);
  }

}
