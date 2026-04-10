import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260410033050 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "campaign_attribution" drop constraint if exists "campaign_attribution_platform_check";`);

    this.addSql(`alter table if exists "campaign_attribution" alter column "platform" type text using ("platform"::text);`);
    this.addSql(`alter table if exists "campaign_attribution" alter column "platform" set default 'direct';`);
    this.addSql(`alter table if exists "campaign_attribution" add constraint "campaign_attribution_platform_check" check("platform" in ('meta', 'google', 'generic', 'direct'));`);

    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "idx_segment_member_unique" ON "segment_member" ("segment_id", "person_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "campaign_attribution" drop constraint if exists "campaign_attribution_platform_check";`);

    this.addSql(`alter table if exists "campaign_attribution" alter column "platform" type text using ("platform"::text);`);
    this.addSql(`alter table if exists "campaign_attribution" alter column "platform" set default 'meta';`);
    this.addSql(`alter table if exists "campaign_attribution" add constraint "campaign_attribution_platform_check" check("platform" in ('meta', 'google', 'generic'));`);

    this.addSql(`drop index if exists "idx_segment_member_unique";`);
  }

}
