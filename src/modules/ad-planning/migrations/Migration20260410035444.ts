import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260410035444 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`drop index if exists "idx_forecast_campaign_date";`);

    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "idx_forecast_campaign_date_unique" ON "budget_forecast" ("ad_campaign_id", "forecast_date") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "conversion" alter column "currency" drop default;`);
    this.addSql(`alter table if exists "conversion" alter column "currency" type text using ("currency"::text);`);
    this.addSql(`alter table if exists "conversion" alter column "currency" drop not null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "idx_forecast_campaign_date_unique";`);

    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_forecast_campaign_date" ON "budget_forecast" ("ad_campaign_id", "forecast_date") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "conversion" alter column "currency" type text using ("currency"::text);`);
    this.addSql(`alter table if exists "conversion" alter column "currency" set default 'INR';`);
    this.addSql(`alter table if exists "conversion" alter column "currency" set not null;`);
  }

}
