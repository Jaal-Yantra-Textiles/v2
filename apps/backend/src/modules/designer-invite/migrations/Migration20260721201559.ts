import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260721201559 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "designer_invite" drop constraint if exists "designer_invite_token_hash_unique";`);
    this.addSql(`create table if not exists "designer_invite" ("id" text not null, "design_id" text not null, "email" text null, "token_hash" text not null, "status" text check ("status" in ('pending', 'accepted', 'revoked')) not null default 'pending', "role" text null, "expires_at" timestamptz null, "invited_by" text null, "inviter_name" text null, "accepted_partner_id" text null, "accepted_at" timestamptz null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "designer_invite_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_designer_invite_token_hash_unique" ON "designer_invite" ("token_hash") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_designer_invite_deleted_at" ON "designer_invite" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "designer_invite" cascade;`);
  }

}
