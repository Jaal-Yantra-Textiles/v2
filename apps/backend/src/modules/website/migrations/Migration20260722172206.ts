import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260722172206 extends Migration {

  override async up(): Promise<void> {
    // #349: per-Website Google Search Console site-verification token, injected
    // into the storefront <head> independent of the analytics provider.
    this.addSql(`alter table if exists "website" add column if not exists "google_site_verification" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "website" drop column if exists "google_site_verification";`);
  }

}
