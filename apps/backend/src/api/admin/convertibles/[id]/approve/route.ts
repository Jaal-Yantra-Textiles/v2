import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { INVESTOR_MODULE } from "../../../../../modules/investor"
import type InvestorService from "../../../../../modules/investor/service"
import { createPayuLink } from "../../../lib/create-payu-link"

// POST /admin/convertibles/:id/approve — approve a SAFE / convertible
// commitment: create a pending Payment for the principal and generate a PayU
// link. Mirrors the stake approve flow (reuses createPayuLink) so SAFE holders
// pay through the same rail; settlement is reconciled by the PayU webhook.
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)

  const { data } = await query.graph({
    entity: "convertible",
    filters: { id: req.params.id },
    fields: [
      "id",
      "investor_id",
      "principal_amount",
      "currency_code",
      "metadata",
      "investor.name",
      "investor.email",
      "cap_table.company_id",
      "cap_table.currency_code",
    ],
  })
  const convertible = data?.[0] as any
  if (!convertible) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Convertible not found")
  }
  const amount = Number(convertible.principal_amount ?? 0)
  if (amount <= 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "This SAFE has no principal amount to collect"
    )
  }

  const companyId = convertible.cap_table?.company_id
  const currency =
    convertible.currency_code || convertible.cap_table?.currency_code || "INR"

  // 1) pending Payment (typed as a convertible payment)
  const payment: any = await service.createPayments({
    convertible_id: convertible.id,
    investor_id: convertible.investor_id,
    company_id: companyId,
    amount,
    currency_code: currency,
    payment_type: "convertible",
    status: "pending",
  } as any)

  // 2) PayU link — same helper the stake flow uses.
  const portal = process.env.INVESTOR_UI_URL || "https://investor.jaalyantra.com"
  const link = await createPayuLink(
    {
      amount,
      description: `SAFE investment — ${convertible.id}`,
      customer: {
        name: convertible.investor?.name,
        email: convertible.investor?.email,
      },
      successURL: `${portal}/finances?paid=1`,
      failureURL: `${portal}/finances?paid=0`,
      reference: payment.id,
    },
    logger
  )

  // 3) persist link on the payment + mark the convertible approved
  await service.updatePayments({
    id: payment.id,
    reference_number: link.invoice_number ?? undefined,
    metadata: {
      payu_payment_link: link.payment_link,
      payu_invoice_number: link.invoice_number,
    },
  } as any)
  await service.updateConvertibles({
    id: convertible.id,
    metadata: {
      ...(convertible.metadata || {}),
      approved: true,
      approved_at: new Date().toISOString(),
    },
  } as any)

  res.json({
    payment_id: payment.id,
    payment_link: link.payment_link,
    payu_error: link.error ?? null,
  })
}
