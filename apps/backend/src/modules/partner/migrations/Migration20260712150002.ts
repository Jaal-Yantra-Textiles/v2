import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Multi-provider hosting columns (#884 S3) — add the provider-agnostic
 * storefront hosting fields to `partner`:
 *   - hosting_provider          which provider the storefront lives on
 *   - deployment_account_id     the rotated deployment_account it was placed on
 *   - deployment_project_id     provider project id (Vercel id / Render service id)
 *   - deployment_project_name   provider project name (Cloudflare Pages / Netlify site)
 *
 * These supersede the vercel_* columns; the vercel_* columns remain for
 * backwards-compat reads of pre-#884 partners (see resolve-partner-provider.ts).
 *
 * Hand-written idempotent ALTER (add-column-if-not-exists) because `partner`
 * already exists on live DBs (the create-if-not-exists migration hazard).
 */
export class Migration20260712150002 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "partner" add column if not exists "hosting_provider" text null;`);
    this.addSql(`alter table if exists "partner" add column if not exists "deployment_account_id" text null;`);
    this.addSql(`alter table if exists "partner" add column if not exists "deployment_project_id" text null;`);
    this.addSql(`alter table if exists "partner" add column if not exists "deployment_project_name" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "partner" drop column if exists "hosting_provider";`);
    this.addSql(`alter table if exists "partner" drop column if exists "deployment_account_id";`);
    this.addSql(`alter table if exists "partner" drop column if exists "deployment_project_id";`);
    this.addSql(`alter table if exists "partner" drop column if exists "deployment_project_name";`);
  }

}
