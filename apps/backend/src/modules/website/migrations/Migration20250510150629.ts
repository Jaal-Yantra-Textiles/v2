import { Migration } from '@mikro-orm/migrations';

export class Migration20250510150629 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "page" add column if not exists "sent_to_subscribers" boolean not null default false, add column if not exists "sent_to_subscribers_at" timestamptz null, add column if not exists "subscriber_count" integer null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "page" drop column if exists "sent_to_subscribers", drop column if exists "sent_to_subscribers_at", drop column if exists "subscriber_count";`);
  }

}
