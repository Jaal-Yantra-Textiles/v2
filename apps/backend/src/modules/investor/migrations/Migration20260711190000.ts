import { Migration } from '@mikro-orm/migrations';

// Company operating expenses (partnership cost, tech stack, etc.) — #969 follow-up.
// Creates the `company_expense` table that panels roll up as company expenses.
export class Migration20260711190000 extends Migration {

  async up(): Promise<void> {
    this.addSql(`create table if not exists "company_expense" (
      "id" text not null,
      "company_id" text null,
      "category" text check ("category" in ('partnership', 'tech_stack', 'marketing', 'operations', 'salaries', 'other')) not null default 'other',
      "name" text not null,
      "amount" numeric not null,
      "currency_code" text not null default 'INR',
      "recurrence" text check ("recurrence" in ('one_time', 'monthly', 'annual')) not null default 'monthly',
      "incurred_date" timestamptz null,
      "status" text check ("status" in ('active', 'ended')) not null default 'active',
      "notes" text null,
      "metadata" jsonb null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "company_expense_pkey" primary key ("id")
    );`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_company_expense_company_id" ON "company_expense" ("company_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_company_expense_category" ON "company_expense" ("category") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_company_expense_deleted_at" ON "company_expense" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "company_expense" cascade;`);
  }

}
