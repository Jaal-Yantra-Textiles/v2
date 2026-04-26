import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260424120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "google_merchant_account" add column if not exists "token_refreshed_at" timestamptz null;`
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "google_merchant_account" drop column if exists "token_refreshed_at";`
    );
  }
}
