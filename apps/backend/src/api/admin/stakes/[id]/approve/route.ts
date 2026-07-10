import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { INVESTOR_MODULE } from "../../../../../modules/investor"
import type InvestorService from "../../../../../modules/investor/service"
import { createPayuLink } from "../../../lib/create-payu-link"

// POST /admin/stakes/:id/approve — approve a participation: create a pending
// Payment for the invested amount and generate a PayU capital-call link. The
// investor pays the link; on success the stake is marked fully_paid (webhook or
// the admin mark-paid action).
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)

  const { data } = await query.graph({
    entity: "stake",
    filters: { id: req.params.id },
    fields: [
      "id",
      "investor_id",
      "total_invested",
      "metadata",
      "investor.name",
      "investor.email",
      "cap_table.company_id",
      "cap_table.currency_code",
    ],
  })
  const stake = data?.[0] as any
  if (!stake) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Participation not found")
  }
  const amount = Number(stake.total_invested ?? 0)
  if (amount <= 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "This participation has no invested amount to collect"
    )
  }

  const companyId = stake.cap_table?.company_id
  const currency = stake.cap_table?.currency_code || "INR"

  // 1) pending Payment
  const payment: any = await service.createPayments({
    stake_id: stake.id,
    investor_id: stake.investor_id,
    company_id: companyId,
    amount,
    currency_code: currency,
    payment_type: "subscription",
    status: "pending",
  } as any)

  // 2) PayU capital-call link (never throws; returns { payment_link: null } if
  //    PayU isn't configured — the pending Payment still exists for manual pay).
  const portal = process.env.INVESTOR_UI_URL || "https://investor.jaalyantra.com"
  const link = await createPayuLink(
    {
      amount,
      description: `Capital call — ${stake.id}`,
      customer: {
        name: stake.investor?.name,
        email: stake.investor?.email,
      },
      // Redirect the investor back to the portal after paying; settlement is
      // reconciled by POST /webhooks/payu/investor (udf1 = this payment id).
      successURL: `${portal}/finances?paid=1`,
      failureURL: `${portal}/finances?paid=0`,
      reference: payment.id,
    },
    logger
  )

  // 3) persist link on the payment + mark the stake approved
  await service.updatePayments({
    id: payment.id,
    reference_number: link.invoice_number ?? undefined,
    metadata: {
      payu_payment_link: link.payment_link,
      payu_invoice_number: link.invoice_number,
    },
  } as any)
  await service.updateStakes({
    id: stake.id,
    metadata: {
      ...(stake.metadata || {}),
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
