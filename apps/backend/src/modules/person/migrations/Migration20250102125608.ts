import { Migration } from '@mikro-orm/migrations';

export class Migration20250102125608 extends Migration {

  async up(): Promise<void> {
    this.addSql('alter table if exists "person_tags" drop constraint if exists "person_tags_persons_id_foreign";');

    this.addSql('drop index if exists "IDX_person_tags_persons_id";');
    this.addSql('alter table if exists "person_tags" rename column "persons_id" to "person_id";');
    this.addSql('alter table if exists "person_tags" add constraint "person_tags_person_id_foreign" foreign key ("person_id") references "person" ("id") on update cascade;');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_person_tags_person_id" ON "person_tags" (person_id) WHERE deleted_at IS NULL;');
  }

  async down(): Promise<void> {
    this.addSql('alter table if exists "person_tags" drop constraint if exists "person_tags_person_id_foreign";');

    this.addSql('drop index if exists "IDX_person_tags_person_id";');
    this.addSql('alter table if exists "person_tags" rename column "person_id" to "persons_id";');
    this.addSql('alter table if exists "person_tags" add constraint "person_tags_persons_id_foreign" foreign key ("persons_id") references "person" ("id") on update cascade;');
    this.addSql('CREATE INDEX IF NOT EXISTS "IDX_person_tags_persons_id" ON "person_tags" (persons_id) WHERE deleted_at IS NULL;');
  }

}
