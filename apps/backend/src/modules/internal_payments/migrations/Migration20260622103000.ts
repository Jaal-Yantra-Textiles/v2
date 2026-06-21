import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * #496 — file↔payment link table for internal payments.
 * New table only (safe `create table if not exists`); no column-add to an
 * existing create-if-not-exists table.
 */
export class Migration20260622103000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "internal_payment_attachment" (
      "id" text not null,
      "file_id" text not null,
      "url" text not null,
      "filename" text null,
      "mime_type" text null,
      "size" integer null,
      "metadata" jsonb null,
      "payment_id" text not null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "internal_payment_attachment_pkey" primary key ("id")
    );`);

    this.addSql(`create index if not exists "IDX_internal_payment_attachment_payment_id" on "internal_payment_attachment" ("payment_id") where "deleted_at" is null;`);
    this.addSql(`create index if not exists "IDX_internal_payment_attachment_deleted_at" on "internal_payment_attachment" ("deleted_at") where "deleted_at" is null;`);

    this.addSql(`alter table if exists "internal_payment_attachment" drop constraint if exists "internal_payment_attachment_payment_id_foreign";`);
    this.addSql(`alter table if exists "internal_payment_attachment" add constraint "internal_payment_attachment_payment_id_foreign" foreign key ("payment_id") references "internal_payments" ("id") on update cascade on delete cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "internal_payment_attachment" cascade;`);
  }

}
