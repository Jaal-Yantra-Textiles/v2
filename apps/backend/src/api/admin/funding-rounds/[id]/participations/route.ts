import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { AGREEMENT_RESPONSE_MODULE } from "../../../../../modules/agreement-responses"

// GET /admin/funding-rounds/:id/participations — investor participations on this
// round, with investor + any payment (to show status / PayU link) + the issued
// subscription agreement (to issue / mark-signed from the dashboard). Equity
// rounds yield `stake` participations; SAFE / convertible rounds yield
// `convertible` ones — both are returned with a `type` discriminator so one
// screen handles both.
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

  // Attach the issued subscription agreement (if any) per participation. The
  // generate workflow stamps `metadata.stake_id` / `metadata.convertible_id` on
  // the agreement_response, so match on that — scoped to the participants'
  // emails to keep the scan tight. Lets the dashboard show issue / mark-signed.
  const emails = Array.from(
    new Set(
      participations.map((p: any) => p.investor?.email).filter(Boolean)
    )
  )
  let responses: any[] = []
  if (emails.length) {
    try {
      const responseSvc: any = req.scope.resolve(AGREEMENT_RESPONSE_MODULE)
      responses = await responseSvc.listAgreementResponses({
        email_sent_to: emails,
      })
    } catch {
      responses = []
    }
  }
  const withAgreements = participations.map((p: any) => {
    const r = responses.find(
      (x) =>
        (p.type === "stake" && x.metadata?.stake_id === p.id) ||
        (p.type === "convertible" && x.metadata?.convertible_id === p.id)
    )
    return {
      ...p,
      agreement: r
        ? {
            id: r.id,
            status: r.status,
            agreed: r.agreed,
            responded_at: r.responded_at,
            signed_by_admin: !!r.metadata?.signed_by_admin,
          }
        : null,
    }
  })

  res.json({ participations: withAgreements, count: withAgreements.length })
}
