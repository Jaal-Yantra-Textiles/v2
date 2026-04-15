import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260415031047 extends Migration {

  override async up(): Promise<void> {

    this.addSql(`alter table if exists "production_runs" add column if not exists "lifecycle_transaction_id" text null;`);
  }

  override async down(): Promise<void> {

    this.addSql(`alter table if exists "production_runs" drop column if exists "lifecycle_transaction_id";`);
  }

}
