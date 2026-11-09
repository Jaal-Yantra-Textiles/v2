import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * #2532 — create `tax_invoice`. Hand-written `create table if not exists`, like
 * the platform-tax-identity migrations: `db:generate` diffs against the local
 * DB and emits unrelated changes.
 *
 * The two unique indexes are the numbering guarantee: a concurrent issue that
 * picks the same (financial_year, sequence) fails instead of duplicating a
 * GST invoice number.
 */
export class Migration20261109120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "tax_invoice" (
      "id" text not null,
      "order_id" text not null,
      "invoice_number" text not null,
      "financial_year" text not null,
      "sequence" integer not null,
      "status" text check ("status" in ('issued', 'cancelled')) not null default 'issued',
      "issued_at" timestamptz not null,
      "currency_code" text not null,
      "grand_total" numeric not null,
      "raw_grand_total" jsonb not null,
      "document" jsonb not null,
      "cancelled_at" timestamptz null,
      "cancel_reason" text null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "tax_invoice_pkey" primary key ("id")
    );`);

    this.addSql(`create index if not exists "IDX_tax_invoice_deleted_at" on "tax_invoice" ("deleted_at") where "deleted_at" is null;`);
    this.addSql(`create index if not exists "IDX_tax_invoice_order_id" on "tax_invoice" ("order_id") where "deleted_at" is null;`);
    this.addSql(`create unique index if not exists "IDX_tax_invoice_invoice_number_unique" on "tax_invoice" ("invoice_number") where "deleted_at" is null;`);
    this.addSql(`create unique index if not exists "IDX_tax_invoice_financial_year_sequence_unique" on "tax_invoice" ("financial_year", "sequence") where "deleted_at" is null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "tax_invoice" cascade;`);
  }

}
