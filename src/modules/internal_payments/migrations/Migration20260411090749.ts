import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260411090749 extends Migration {

  override async up(): Promise<void> {
    // Make paid_to_id nullable and update the foreign key to SET NULL on delete
    this.addSql(`alter table if exists "internal_payments" alter column "paid_to_id" drop not null;`);
    this.addSql(`alter table if exists "internal_payments" drop constraint if exists "internal_payments_paid_to_id_foreign";`);
    this.addSql(`alter table if exists "internal_payments" add constraint "internal_payments_paid_to_id_foreign" foreign key ("paid_to_id") references "internal_payment_details" ("id") on update cascade on delete set null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "internal_payments" alter column "paid_to_id" set not null;`);
    this.addSql(`alter table if exists "internal_payments" drop constraint if exists "internal_payments_paid_to_id_foreign";`);
    this.addSql(`alter table if exists "internal_payments" add constraint "internal_payments_paid_to_id_foreign" foreign key ("paid_to_id") references "internal_payment_details" ("id") on update cascade;`);
  }

}
