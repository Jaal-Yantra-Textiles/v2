import { Migration } from '@mikro-orm/migrations';

// Participation lifecycle — #969 follow-up.
//
// Adds two negative/terminal states to `stake.status`:
//  - 'rejected'        — admin declined the participant.
//  - 'not_followed_up' — investor never paid/responded; parked.
// Both are excluded from the capital table (only 'fully_paid' stakes count as
// absorbed). No new columns — just widens the existing status CHECK.
// Idempotent (drop-if-exists → add) so it's safe to re-run on boot.
export class Migration20260712140000 extends Migration {

  async up(): Promise<void> {
    this.addSql(`alter table if exists "stake" drop constraint if exists "stake_status_check";`);
    this.addSql(`alter table if exists "stake" add constraint "stake_status_check" check ("status" in ('active', 'fully_paid', 'partially_paid', 'unpaid', 'cancelled', 'rejected', 'not_followed_up'));`);
  }

  async down(): Promise<void> {
    this.addSql(`alter table if exists "stake" drop constraint if exists "stake_status_check";`);
    this.addSql(`alter table if exists "stake" add constraint "stake_status_check" check ("status" in ('active', 'fully_paid', 'partially_paid', 'unpaid', 'cancelled'));`);
  }

}
