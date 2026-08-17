import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Creates the three mcp_oauth tables (#1306 Track B — the OAuth front door).
 *
 * Hand-written to mirror what DML would generate, following the mcp_access
 * precedent: partial unique indexes (WHERE deleted_at IS NULL) so a soft-deleted
 * row never blocks re-registering the same client, plus the standard deleted_at
 * indexes.
 *
 * Idempotent (`if not exists` throughout) — a re-run is a no-op rather than a
 * failure the migrate job would then report as success (#1208).
 *
 * ⚠️ Without these tables the OAuth routes 500 and `/mcp/admin` fails closed,
 * exactly as `/admin/mcp` did when mcp_access_scope was missing. Check the
 * migrate log for `MODULE: mcp_oauth` after deploying.
 */
export class Migration20260817030000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "mcp_oauth_client" ("id" text not null, "client_id" text not null, "client_secret_hash" text null, "client_name" text not null, "redirect_uris" jsonb not null, "grant_types" jsonb null, "token_endpoint_auth_method" text not null default 'none', "scope" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "mcp_oauth_client_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_mcp_oauth_client_client_id_unique" ON "mcp_oauth_client" ("client_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_mcp_oauth_client_deleted_at" ON "mcp_oauth_client" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "mcp_oauth_grant" ("id" text not null, "code_hash" text not null, "client_id" text not null, "redirect_uri" text not null, "code_challenge" text not null, "code_challenge_method" text not null default 'S256', "user_id" text not null, "auth_identity_id" text null, "level" text not null default 'read', "state" text null, "expires_at" timestamptz not null, "consumed_at" timestamptz null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "mcp_oauth_grant_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_mcp_oauth_grant_code_hash_unique" ON "mcp_oauth_grant" ("code_hash") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_mcp_oauth_grant_deleted_at" ON "mcp_oauth_grant" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "mcp_oauth_token" ("id" text not null, "client_id" text not null, "user_id" text not null, "auth_identity_id" text null, "level" text not null default 'read', "refresh_token_hash" text null, "access_expires_at" timestamptz null, "refresh_expires_at" timestamptz null, "revoked_at" timestamptz null, "last_used_at" timestamptz null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "mcp_oauth_token_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_mcp_oauth_token_refresh_hash_unique" ON "mcp_oauth_token" ("refresh_token_hash") WHERE refresh_token_hash IS NOT NULL AND deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_mcp_oauth_token_user_id" ON "mcp_oauth_token" ("user_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_mcp_oauth_token_deleted_at" ON "mcp_oauth_token" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "mcp_oauth_token" cascade;`);
    this.addSql(`drop table if exists "mcp_oauth_grant" cascade;`);
    this.addSql(`drop table if exists "mcp_oauth_client" cascade;`);
  }

}
