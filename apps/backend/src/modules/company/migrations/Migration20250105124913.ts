import { Migration } from '@mikro-orm/migrations';

export class Migration20250105124913 extends Migration {

  async up(): Promise<void> {
    this.addSql('create table if not exists "companies" ("id" text not null, "name" text not null, "legal_name" text not null, "website" text null, "logo_url" text null, "email" text not null, "phone" text not null, "address" text not null, "city" text not null, "state" text not null, "country" text not null, "postal_code" text not null, "registration_number" text null, "tax_id" text null, "status" text check ("status" in (\'Active\', \'Inactive\', \'Pending\', \'Suspended\')) not null default \'Active\', "founded_date" timestamptz null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "companies_pkey" primary key ("id"));');
    this.addSql('CREATE UNIQUE INDEX IF NOT EXISTS "IDX_companies_email_unique" ON "companies" (email) WHERE deleted_at IS NULL;');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_companies_deleted_at" ON "companies" (deleted_at) WHERE deleted_at IS NULL;');
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "companies" cascade;');
  }

}
