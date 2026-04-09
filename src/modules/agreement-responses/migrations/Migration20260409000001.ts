import { Migration } from "@mikro-orm/migrations";

export class Migration20260409000001 extends Migration {
  override async up(): Promise<void> {
    // The agreement_response table already exists from the agreements module.
    // This module now takes ownership. Drop the foreign key constraint since
    // the agreement relationship is now managed via a module link, not ORM.
    this.addSql(
      `ALTER TABLE IF EXISTS "agreement_response" DROP CONSTRAINT IF EXISTS "agreement_response_agreement_id_foreign";`
    );

    // Safety net for fresh installs where the table doesn't exist yet
    this.addSql(`CREATE TABLE IF NOT EXISTS "agreement_response" (
      "id" text NOT NULL,
      "status" text CHECK ("status" IN ('sent', 'viewed', 'agreed', 'disagreed', 'expired')) NOT NULL DEFAULT 'sent',
      "sent_at" timestamptz NOT NULL,
      "viewed_at" timestamptz NULL,
      "responded_at" timestamptz NULL,
      "agreed" boolean NULL,
      "response_notes" text NULL,
      "email_sent_to" text NOT NULL,
      "email_opened" boolean NOT NULL DEFAULT false,
      "email_opened_at" timestamptz NULL,
      "access_token" text NOT NULL,
      "response_ip" text NULL,
      "response_user_agent" text NULL,
      "metadata" jsonb NULL,
      "agreement_id" text NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      "deleted_at" timestamptz NULL,
      CONSTRAINT "agreement_response_pkey" PRIMARY KEY ("id")
    );`);

    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_agreement_response_agreement_id" ON "agreement_response" ("agreement_id") WHERE "deleted_at" IS NULL;`
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_agreement_response_deleted_at" ON "agreement_response" ("deleted_at") WHERE "deleted_at" IS NULL;`
    );
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_agreement_response_access_token_unique" ON "agreement_response" ("access_token") WHERE "deleted_at" IS NULL;`
    );
  }

  override async down(): Promise<void> {
    // Restore the foreign key if rolling back
    this.addSql(
      `ALTER TABLE IF EXISTS "agreement_response" ADD CONSTRAINT "agreement_response_agreement_id_foreign" FOREIGN KEY ("agreement_id") REFERENCES "agreement" ("id") ON UPDATE CASCADE;`
    );
  }
}
