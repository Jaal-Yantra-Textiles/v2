import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createFormWorkflow } from "../workflows/forms/create-form"
import type { CreateFormStepInput } from "../workflows/forms/create-form"

/**
 * Seed marketing forms — waitlist, investor-intro, demo-request — for each
 * marketing website. Idempotent: forms keyed by (handle, website_id) are
 * skipped if they already exist.
 *
 * Usage:
 *   npx medusa exec src/scripts/seed-marketing-forms.ts
 *
 * Re-run any time after adding a new marketing domain — only the missing
 * combinations are created.
 */

const DOMAINS = ["jaalyantra.com", "kindhealth.com"]

type FormDef = Pick<
  CreateFormStepInput,
  "handle" | "title" | "description" | "success_message" | "fields"
>

const FORMS: FormDef[] = [
  {
    handle: "waitlist",
    title: "Join the waitlist",
    description: "Consumer-side waitlist for custom clothing.",
    success_message: "Got it. We'll be in touch.",
    fields: [
      { name: "email", label: "Email", type: "email", required: true, order: 0 },
      {
        name: "mode",
        label: "Mode",
        type: "text",
        required: false,
        order: 1,
        help_text: "consumer / investor / platform",
      },
    ],
  },
  {
    handle: "investor-intro",
    title: "Investor introduction",
    description: "Investor introduction requests — data room + calendar.",
    success_message: "Thanks. Data room incoming.",
    fields: [
      { name: "email", label: "Email", type: "email", required: true, order: 0 },
      { name: "fund", label: "Fund", type: "text", required: false, order: 1 },
    ],
  },
  {
    handle: "demo-request",
    title: "Get a demo",
    description: "Brand demo requests for the JaalYantra platform.",
    success_message: "On the way. Calendar link incoming.",
    fields: [
      { name: "email", label: "Email", type: "email", required: true, order: 0 },
      { name: "mode", label: "Mode", type: "text", required: false, order: 1 },
    ],
  },
  {
    handle: "contact",
    title: "Contact us",
    description: "General contact form used by the /contact page on jyt-web.",
    success_message: "Thanks — we'll be in touch within one business day.",
    fields: [
      { name: "email", label: "Email", type: "email", required: true, order: 0 },
      { name: "name", label: "Name", type: "text", required: true, order: 1 },
      { name: "company", label: "Company", type: "text", required: false, order: 2 },
      { name: "role", label: "Role", type: "text", required: false, order: 3 },
      { name: "message", label: "Message", type: "textarea", required: true, order: 4 },
    ],
  },
]

export default async function seedMarketingForms({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

  for (const domain of DOMAINS) {
    const { data: websites } = await query.graph({
      entity: "website",
      fields: ["id", "domain"],
      filters: { domain },
      pagination: { take: 1 },
    })

    const website = (websites || [])[0]
    if (!website) {
      logger.warn(
        `[seed-marketing-forms] No website found for domain ${domain} — skipping. Create the website in admin first.`
      )
      continue
    }

    logger.info(
      `[seed-marketing-forms] Seeding forms for ${domain} (website_id=${website.id})`
    )

    for (const formDef of FORMS) {
      const { data: existing } = await query.graph({
        entity: "form",
        fields: ["id", "handle"],
        filters: { website_id: website.id, handle: formDef.handle },
        pagination: { take: 1 },
      })

      if (existing?.length) {
        logger.info(
          `  ✓ ${formDef.handle} already exists (id=${existing[0].id}) — skipping`
        )
        continue
      }

      const { result } = await createFormWorkflow(container).run({
        input: {
          ...formDef,
          website_id: website.id,
          domain,
          type: "generic",
          status: "published",
        },
      })

      logger.info(`  + ${formDef.handle} created (id=${(result as any).id})`)
    }
  }

  logger.info("[seed-marketing-forms] Done")
}
