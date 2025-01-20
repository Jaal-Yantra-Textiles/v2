import { Migration } from '@mikro-orm/migrations';

export class Migration20250119093034 extends Migration {

  async up(): Promise<void> {
    this.addSql('alter table if exists "block" drop constraint if exists "block_type_check";');

    this.addSql('alter table if exists "block" alter column "type" type text using ("type"::text);');
    this.addSql('alter table if exists "block" add constraint "block_type_check" check ("type" in (\'Hero\', \'Header\', \'Footer\', \'MainContent\', \'ContactForm\', \'Feature\', \'Gallery\', \'Testimonial\', \'Product\', \'Section\', \'Custom\'));');
    this.addSql('CREATE UNIQUE INDEX IF NOT EXISTS "unique_block_type_per_page" ON "block" (page_id, type) WHERE type IN (\'Hero\', \'Header\', \'Footer\', \'MainContent\', \'ContactForm\') AND deleted_at IS NULL;');
  }

  async down(): Promise<void> {
    this.addSql('alter table if exists "block" drop constraint if exists "block_type_check";');

    this.addSql('alter table if exists "block" alter column "type" type text using ("type"::text);');
    this.addSql('alter table if exists "block" add constraint "block_type_check" check ("type" in (\'Hero\', \'Feature\', \'Content\', \'Gallery\', \'Testimonial\', \'Contact\', \'Custom\'));');
    this.addSql('drop index if exists "unique_block_type_per_page";');
  }

}
