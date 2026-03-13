import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260313031405 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "form_response" drop constraint if exists "form_response_status_check";`);

    this.addSql(`alter table if exists "form_response" add column if not exists "verification_code" text null, add column if not exists "verification_expires_at" timestamptz null;`);
    this.addSql(`alter table if exists "form_response" add constraint "form_response_status_check" check("status" in ('new', 'read', 'archived', 'pending_verification'));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_form_response_verification_code_form_id" ON "form_response" ("verification_code", "form_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "form_response" drop constraint if exists "form_response_status_check";`);

    this.addSql(`drop index if exists "IDX_form_response_verification_code_form_id";`);
    this.addSql(`alter table if exists "form_response" drop column if exists "verification_code", drop column if exists "verification_expires_at";`);

    this.addSql(`alter table if exists "form_response" add constraint "form_response_status_check" check("status" in ('new', 'read', 'archived'));`);
  }

}
