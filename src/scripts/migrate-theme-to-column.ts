/**
 * One-time migration script to copy theme data from website.metadata.theme
 * to the new website.theme column.
 *
 * Run: npx medusa exec ./src/scripts/migrate-theme-to-column.ts
 */
import { ExecArgs } from "@medusajs/framework/types"

export default async function migrateThemeToColumn({ container }: ExecArgs) {
  const websiteService = container.resolve("websites") as any

  const [websites] = await websiteService.listAndCountWebsites(
    {},
    { take: 1000 }
  )

  let migrated = 0
  let skipped = 0

  for (const website of websites) {
    const metadataTheme = website.metadata?.theme
    const hasColumnTheme = website.theme && Object.keys(website.theme).length > 0

    if (metadataTheme && !hasColumnTheme) {
      // Copy metadata.theme → theme column
      await websiteService.updateWebsites({
        selector: { id: website.id },
        data: { theme: metadataTheme },
      })
      console.log(`Migrated theme for website "${website.name}" (${website.id})`)
      migrated++
    } else if (hasColumnTheme) {
      console.log(`Skipped "${website.name}" — theme column already has data`)
      skipped++
    } else {
      console.log(`Skipped "${website.name}" — no theme in metadata`)
      skipped++
    }
  }

  console.log(`\nDone. Migrated: ${migrated}, Skipped: ${skipped}`)
}
