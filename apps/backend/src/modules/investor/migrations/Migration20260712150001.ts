import { Migration } from '@mikro-orm/migrations';

// Investor referrals — #969 follow-up. Lets an investor invite a friend / other
// investor into the portal. Onboarding stays invite-only, so a referral is a
// lead the team follows up on. Idempotent create-table (safe to re-run on boot).
export class Migration20260712150001 extends Migration {

  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "investor_referral" (
        "id" text not null,
        "referrer_investor_id" text not null,
        "company_id" text null,
        "name" text not null,
        "email" text not null,
        "note" text null,
        "access_level" text check ("access_level" in ('view_only', 'investor')) not null default 'investor',
        "status" text check ("status" in ('invited', 'contacted', 'joined', 'declined')) not null default 'invited',
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "investor_referral_pkey" primary key ("id")
      );
    `);
    this.addSql(`create index if not exists "IDX_investor_referral_referrer" on "investor_referral" ("referrer_investor_id") where "deleted_at" is null;`);
    this.addSql(`create index if not exists "IDX_investor_referral_deleted_at" on "investor_referral" ("deleted_at") where "deleted_at" is null;`);
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "investor_referral" cascade;`);
  }

}
