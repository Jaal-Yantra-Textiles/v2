import { Migration } from "@mikro-orm/migrations"

export class Migration20260822120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE IF EXISTS "block"
      DROP CONSTRAINT IF EXISTS "block_type_check";
    `)
    this.addSql(`
      ALTER TABLE "block"
      ADD CONSTRAINT "block_type_check"
      CHECK ("type" IN (
        'Hero', 'Header', 'Footer', 'MainContent', 'ContactForm',
        'Feature', 'Gallery', 'Testimonial', 'Product', 'Section', 'Custom',
        'HeroWithImage', 'BentoGrid', 'Button'
      ));
    `)
  }

  override async down(): Promise<void> {
    this.addSql(`
      ALTER TABLE IF EXISTS "block"
      DROP CONSTRAINT IF EXISTS "block_type_check";
    `)
    this.addSql(`
      ALTER TABLE "block"
      ADD CONSTRAINT "block_type_check"
      CHECK ("type" IN (
        'Hero', 'Header', 'Footer', 'MainContent', 'ContactForm',
        'Feature', 'Gallery', 'Testimonial', 'Product', 'Section', 'Custom'
      ));
    `)
  }

}
