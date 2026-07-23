import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { ExecArgs } from "@medusajs/framework/types"
import { EMAIL_TEMPLATES_MODULE } from "../modules/email_templates"
import { emailTemplatesData } from "./seed-email-templates"

/**
 * One-off ops job: UPDATE existing DB email templates in place from the
 * canonical definitions in `seed-email-templates.ts`.
 *
 * Why this exists: `seed-email-templates.ts` intentionally SKIPS templates that
 * already exist (so it never clobbers admin edits). That means edits to a seed
 * template never reach an environment that was already seeded. This job pushes
 * the seed's subject / html_content / from / variables onto the live rows for a
 * chosen set of keys — scoped by TEMPLATE_KEYS so we never touch templates we
 * didn't mean to.
 *
 * Motivating case: the `order-placed` customer confirmation shipped as a stub
 * whose payload never matched its variables (empty "Hi ," / "Order #"). The
 * sending workflow now passes the correct flat vars + partner context
 * (partner_name, store_url); this job upgrades the template body to use them.
 *
 * Idempotent — re-running writes the same content.
 *
 * Usage (prod ships transpiled JS — .js via ECS run-task):
 *   TEMPLATE_KEYS=order-placed DRY_RUN=1 \
 *     npx medusa exec ./src/scripts/update-email-templates.ts
 *   TEMPLATE_KEYS=order-placed \
 *     npx medusa exec ./src/scripts/update-email-templates.ts
 */
export default async function updateEmailTemplates({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const service: any = container.resolve(EMAIL_TEMPLATES_MODULE)

  const dryRun = process.env.DRY_RUN === "1"
  const keys = (process.env.TEMPLATE_KEYS || "order-placed")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

  logger.info(
    `[update-email-templates] keys=[${keys.join(", ")}]${dryRun ? " (dry run)" : ""}`
  )

  let updated = 0
  let missing = 0

  for (const key of keys) {
    const def = (emailTemplatesData as any[]).find(
      (t) => t.template_key === key
    )
    if (!def) {
      logger.warn(
        `[update-email-templates] '${key}' not found in seed data — skip`
      )
      missing++
      continue
    }

    // There can be one row per locale for a key; update them all.
    const [rows] = await service.listAndCountEmailTemplates({
      template_key: key,
    })
    if (!rows || rows.length === 0) {
      logger.warn(
        `[update-email-templates] no DB row for '${key}' — run the seed first; skip`
      )
      missing++
      continue
    }

    for (const row of rows) {
      if (dryRun) {
        logger.info(
          `[update-email-templates] would update '${key}' (${row.id}, locale=${row.locale ?? "-"})`
        )
        updated++
        continue
      }
      await service.updateEmailTemplates({
        id: row.id,
        subject: def.subject,
        html_content: def.html_content,
        from: def.from,
        variables: def.variables,
        template_type: def.template_type,
      })
      logger.info(
        `[update-email-templates] updated '${key}' (${row.id}, locale=${row.locale ?? "-"})`
      )
      updated++
    }
  }

  logger.info(
    `[update-email-templates] done — ${updated} ${dryRun ? "would be " : ""}updated, ${missing} missing`
  )
}
