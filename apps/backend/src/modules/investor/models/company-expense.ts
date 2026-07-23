import { model } from "@medusajs/framework/utils"

/**
 * A recurring or one-off company operating expense (#969 follow-up).
 *
 * Records the cost side of the business shown to investors — partnership cost,
 * tech stack, etc. Kept as typed columns (not metadata) per the repo rule.
 * `company_id` is a plain text ref, matching how `cap_table.company_id` points
 * at the company without widening a cross-module relation.
 *
 * Panels roll these up (e.g. "Partnership cost / mo" = sum(amount) where
 * category = partnership & recurrence = monthly & status = active).
 */
const CompanyExpense = model.define("company_expense", {
  id: model.id().primaryKey(),

  company_id: model.text().nullable(),

  category: model
    .enum(["partnership", "tech_stack", "marketing", "operations", "salaries", "other"])
    .default("other"),

  name: model.text(),
  amount: model.bigNumber(),
  currency_code: model.text().default("INR"),

  // How the amount recurs. `monthly` is the run-rate a projection sums directly.
  recurrence: model.enum(["one_time", "monthly", "annual"]).default("monthly"),

  incurred_date: model.dateTime().nullable(),

  status: model.enum(["active", "ended"]).default("active"),

  notes: model.text().nullable(),
  metadata: model.json().nullable(),
})

export default CompanyExpense
