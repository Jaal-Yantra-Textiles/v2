import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { INVESTOR_MODULE } from "../modules/investor"

/**
 * Seeds the two headline company expenses shown to investors — partnership cost
 * and tech stack — as editable monthly rows. Amounts are placeholders: adjust
 * them to the real figures in the admin (POST /admin/company-expenses/:id) — the
 * "Partnership cost / mo" and "Tech stack / mo" panels sum these live.
 *
 * Idempotent: matched by (category, name); re-running leaves existing rows alone.
 *
 * Usage:
 *   npx medusa exec ./src/scripts/seed-company-expenses.ts
 */
const EXPENSES = [
  { category: "partnership", name: "Partner network & onboarding", amount: 2_000, currency_code: "INR" },
  { category: "tech_stack", name: "Cloud, AI & tooling", amount: 5_000, currency_code: "INR" },
]

export default async function seedCompanyExpenses({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const service: any = container.resolve(INVESTOR_MODULE)

  for (const spec of EXPENSES) {
    const existing = await service.listCompanyExpenses(
      { category: spec.category, name: spec.name },
      { take: 1 }
    )
    if ((existing || []).length) {
      logger.info(`Expense "${spec.name}" already exists — leaving as-is`)
      continue
    }
    const [created] = await service.createCompanyExpenses([
      { ...spec, recurrence: "monthly", status: "active" },
    ])
    logger.info(`Created expense "${spec.name}" (${created.id}) — edit amount to the real value`)
  }
}
