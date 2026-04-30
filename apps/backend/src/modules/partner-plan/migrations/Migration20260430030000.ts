import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260430030000 extends Migration {

  override async up(): Promise<void> {
    // Make subscription_payment.subscription_id nullable so the
    // pre-PayU pending row can be created before the subscription
    // exists. Success callback links it back; failure-only audit
    // rows stay orphan.
    this.addSql(
      `alter table if exists "subscription_payment" alter column "subscription_id" drop not null;`
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table if exists "subscription_payment" alter column "subscription_id" set not null;`
    );
  }

}
