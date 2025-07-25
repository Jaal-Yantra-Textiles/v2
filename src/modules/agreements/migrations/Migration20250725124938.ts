import { Migration } from '@mikro-orm/migrations';

export class Migration20250725124938 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "agreement_response" drop constraint if exists "agreement_response_access_token_unique";`);
    
    // First add the column as nullable
    this.addSql(`alter table if exists "agreement_response" add column if not exists "access_token" text;`);
    
    // Update existing records with generated access tokens
    this.addSql(`
      UPDATE "agreement_response" 
      SET "access_token" = 'MIGRATED_' || "id" || '_' || EXTRACT(EPOCH FROM NOW())::bigint || '_' || FLOOR(RANDOM() * 1000000)::text
      WHERE "access_token" IS NULL;
    `);
    
    // Now make the column NOT NULL
    this.addSql(`alter table if exists "agreement_response" alter column "access_token" set not null;`);
    
    // Create the unique index
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_agreement_response_access_token_unique" ON "agreement_response" (access_token) WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_agreement_response_access_token_unique";`);
    this.addSql(`alter table if exists "agreement_response" drop column if exists "access_token";`);
  }

}
