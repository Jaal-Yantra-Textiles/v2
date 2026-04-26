import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260304163723 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "line_fulfillment" alter column "notes" type text using ("notes"::text);`);
    this.addSql(`alter table if exists "line_fulfillment" alter column "notes" drop not null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "line_fulfillment" alter column "notes" type text using ("notes"::text);`);
    this.addSql(`alter table if exists "line_fulfillment" alter column "notes" set not null;`);
  }

}
