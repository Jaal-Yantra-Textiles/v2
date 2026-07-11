import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

// GET /admin/funding-rounds/:id/participations — investor participations on this
// round, with investor + any payment (to show status / PayU link). Equity rounds
// yield `stake` participations; SAFE / convertible rounds yield `convertible`
// ones — both are returned with a `type` discriminator so one screen handles both.
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const [{ data: stakes }, { data: convertibles }] = await Promise.all([
    query.graph({
      entity: "stake",
      filters: { funding_round_id: req.params.id },
      fields: [
        "*",
        "investor.id",
        "investor.name",
        "investor.email",
        "payments.id",
        "payments.amount",
        "payments.status",
        "payments.metadata",
      ],
    }),
    query.graph({
      entity: "convertible",
      filters: { funding_round_id: req.params.id },
      fields: [
        "*",
        "investor.id",
        "investor.name",
        "investor.email",
        "payments.id",
        "payments.amount",
        "payments.status",
        "payments.metadata",
      ],
    }).catch(() => ({ data: [] as any[] })),
  ])

  const participations = [
    ...(stakes || []).map((s: any) => ({ ...s, type: "stake" })),
    ...(convertibles || []).map((c: any) => ({
      ...c,
      type: "convertible",
      // Normalise so the UI can render one column: SAFEs carry `principal_amount`.
      total_invested: c.principal_amount,
    })),
  ]

  res.json({ participations, count: participations.length })
}
