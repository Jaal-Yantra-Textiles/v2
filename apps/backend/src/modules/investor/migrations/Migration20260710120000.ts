import { Migration } from '@mikro-orm/migrations';

// Adds the "onboarded" pipeline stage to the investor_pipeline.stage check
// constraint. The column is a text column with a CHECK constraint (not a native
// pg enum), so we drop and re-add the constraint with the extended value set.
export class Migration20260710120000 extends Migration {

  async up(): Promise<void> {
    this.addSql('alter table if exists "investor_pipeline" drop constraint if exists "investor_pipeline_stage_check";');
    this.addSql('alter table if exists "investor_pipeline" add constraint "investor_pipeline_stage_check" check ("stage" in (\'lead\', \'contacted\', \'interested\', \'due_diligence\', \'term_sheet\', \'committed\', \'onboarded\', \'closed\', \'passed\'));');
  }

  async down(): Promise<void> {
    this.addSql('alter table if exists "investor_pipeline" drop constraint if exists "investor_pipeline_stage_check";');
    this.addSql('alter table if exists "investor_pipeline" add constraint "investor_pipeline_stage_check" check ("stage" in (\'lead\', \'contacted\', \'interested\', \'due_diligence\', \'term_sheet\', \'committed\', \'closed\', \'passed\'));');
  }

}
