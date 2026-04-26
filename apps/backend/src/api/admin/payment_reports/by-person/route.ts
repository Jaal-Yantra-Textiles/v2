/**
 * GET /admin/payment_reports/by-person
 *
 * Live aggregate: payments grouped by person.
 * Each item: { person_id, person_name, total_amount, payment_count, by_status, by_type }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import PersonPaymentsLink from "../../../../links/person-payments-link"
import { ReportingQuery } from "../validators"

export const GET = async (req: MedusaRequest<ReportingQuery>, res: MedusaResponse) => {
  const {
    period_start,
    period_end,
    status,
    payment_type,
  } = (req.validatedQuery ?? {}) as Partial<ReportingQuery>

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data } = await query.graph({
    entity: PersonPaymentsLink.entryPoint,
    fields: [
      "person_id",
      "person.*",
      "internal_payments.*",
    ],
  })

  const start = period_start ? new Date(period_start) : null
  const end = period_end ? new Date(period_end) : null

  const personMap: Record<
    string,
    { person_id: string; person_name: string; payments: any[] }
  > = {}

  for (const row of data ?? []) {
    const payments: any[] = Array.isArray(row.internal_payments)
      ? row.internal_payments
      : row.internal_payments
      ? [row.internal_payments]
      : []

    for (const p of payments) {
      const pd = p.payment_date ? new Date(p.payment_date) : null
      if (start && pd && pd < start) continue
      if (end && pd && pd > end) continue
      if (status && p.status !== status) continue
      if (payment_type && p.payment_type !== payment_type) continue

      const pid = row.person_id as string
      if (!personMap[pid]) {
        const person = row.person as any
        const name = person
          ? `${person.first_name ?? ""} ${person.last_name ?? ""}`.trim() || pid
          : pid
        personMap[pid] = { person_id: pid, person_name: name, payments: [] }
      }
      personMap[pid].payments.push(p)
    }
  }

  const result = Object.values(personMap).map(({ person_id, person_name, payments }) => {
    let total_amount = 0
    const by_status: Record<string, number> = {}
    const by_type: Record<string, number> = {}

    for (const p of payments) {
      const amount = Number(p.amount ?? 0)
      total_amount += amount
      const s = p.status ?? "Unknown"
      by_status[s] = (by_status[s] ?? 0) + 1
      const t = p.payment_type ?? "Unknown"
      by_type[t] = (by_type[t] ?? 0) + amount
    }

    return { person_id, person_name, total_amount, payment_count: payments.length, by_status, by_type }
  }).sort((a, b) => b.total_amount - a.total_amount)

  res.status(200).json({ by_person: result, count: result.length })
}
