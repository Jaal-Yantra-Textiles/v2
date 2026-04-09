import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

export default async function migrateAgreementResponseLinks({ container }: ExecArgs) {
  const pgConnection = container.resolve(
    ContainerRegistrationKeys.PG_CONNECTION
  ) as any;
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);

  logger.info("Starting agreement response link migration...");

  // Check if old link table exists
  const oldTableCheck = await pgConnection.raw(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_name = 'person_person_agreements_agreement_response'
    );
  `);

  if (!oldTableCheck.rows[0].exists) {
    logger.info("Old link table 'person_person_agreements_agreement_response' does not exist, skipping migration.");
    return;
  }

  // Check if new link table exists
  const newTableCheck = await pgConnection.raw(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_name = 'person_person_agreementresponse_agreement_response'
    );
  `);

  if (!newTableCheck.rows[0].exists) {
    logger.warn("New link table 'person_person_agreementresponse_agreement_response' does not exist yet. Run migrations first.");
    return;
  }

  // Count existing rows in old table
  const oldCount = await pgConnection.raw(`
    SELECT COUNT(*) as count FROM "person_person_agreements_agreement_response" WHERE "deleted_at" IS NULL;
  `);
  logger.info(`Found ${oldCount.rows[0].count} active links in old table.`);

  if (parseInt(oldCount.rows[0].count) === 0) {
    logger.info("No links to migrate.");
    return;
  }

  // Copy data from old to new link table
  const result = await pgConnection.raw(`
    INSERT INTO "person_person_agreementresponse_agreement_response"
      ("id", "person_id", "agreement_response_id", "created_at", "updated_at", "deleted_at")
    SELECT "id", "person_id", "agreement_response_id", "created_at", "updated_at", "deleted_at"
    FROM "person_person_agreements_agreement_response"
    WHERE "deleted_at" IS NULL
    ON CONFLICT ("person_id", "agreement_response_id") DO NOTHING;
  `);

  logger.info(`Migrated ${result.rowCount ?? 'unknown number of'} agreement response links to new table.`);

  // Verify migration
  const newCount = await pgConnection.raw(`
    SELECT COUNT(*) as count FROM "person_person_agreementresponse_agreement_response" WHERE "deleted_at" IS NULL;
  `);
  logger.info(`New table now has ${newCount.rows[0].count} active links.`);

  logger.info("Migration complete.");
  logger.info("After verification, you can drop the old table:");
  logger.info("  DROP TABLE IF EXISTS person_person_agreements_agreement_response;");
}
