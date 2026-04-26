import { Migration } from '@mikro-orm/migrations';

export class Migration20250107065318 extends Migration {

  async up(): Promise<void> {
    this.addSql('alter table if exists "raw_materials" drop constraint if exists "raw_materials_material_type_id_foreign";');

    this.addSql('alter table if exists "raw_materials" alter column "material_type_id" type text using ("material_type_id"::text);');
    this.addSql('alter table if exists "raw_materials" alter column "material_type_id" drop not null;');
    this.addSql('alter table if exists "raw_materials" add constraint "raw_materials_material_type_id_foreign" foreign key ("material_type_id") references "material_types" ("id") on update cascade on delete set null;');
  }

  async down(): Promise<void> {
    this.addSql('alter table if exists "raw_materials" drop constraint if exists "raw_materials_material_type_id_foreign";');

    this.addSql('alter table if exists "raw_materials" alter column "material_type_id" type text using ("material_type_id"::text);');
    this.addSql('alter table if exists "raw_materials" alter column "material_type_id" set not null;');
    this.addSql('alter table if exists "raw_materials" add constraint "raw_materials_material_type_id_foreign" foreign key ("material_type_id") references "material_types" ("id") on update cascade;');
  }

}
