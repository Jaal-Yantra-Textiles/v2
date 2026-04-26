import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import crypto from "crypto"
import { PARTNER_PLAN_MODULE } from "../../../modules/partner-plan"
import PartnerPlanService from "../../../modules/partner-plan/service"
import { getPartnerFromAuthContext } from "../helpers"
import { createPartnerSubscriptionWorkflow } from "../../../workflows/partner-subscription/create-subscription"
import { cancelPartnerSubscriptionWorkflow } from "../../../workflows/partner-subscription/cancel-subscription"
import { SubscriptionPaymentStatus } from "../../../modules/partner-plan/types"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "No partner associated with this account")
  }

  const service: PartnerPlanService = req.scope.resolve(PARTNER_PLAN_MODULE)

  const [subscriptions] = await service.listAndCountPartnerSubscriptions(
    { partner_id: partner.id, status: "active" as any },
    { take: 1, relations: ["plan", "payments"] }
  )

  const subscription = subscriptions[0] || null

  const [plans] = await service.listAndCountPartnerPlans(
    { is_active: true },
    { order: { sort_order: "ASC" }, take: 100 }
  )

  const partnerCurrency = (partner.metadata as any)?.currency_code || "inr"
  const recommended_provider = partnerCurrency === "inr" ? "payu" : "stripe"

  res.json({ subscription, plans, recommended_provider })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "No partner associated with this account")
  }

  const { plan_id } = req.validatedBody as { plan_id: string }

  const service: PartnerPlanService = req.scope.resolve(PARTNER_PLAN_MODULE)
  const plan = await service.retrievePartnerPlan(plan_id)

  if (!plan || !plan.is_active) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Plan not found or is inactive")
  }

  // Free plans — activate immediately
  if (plan.price === 0) {
    const { result, errors } = await createPartnerSubscriptionWorkflow(req.scope).run({
      input: { partner_id: partner.id, plan_id },
    })
    if (errors.length > 0) throw errors[0]
    return res.status(201).json({ ...result, payment_url: null })
  }

  // Paid plans — determine payment provider and create payment session
  const partnerCurrency = (partner.metadata as any)?.currency_code || "inr"
  const provider = partnerCurrency === "inr" ? "payu" : "stripe"

  if (provider === "payu") {
    const payuKey = process.env.PAYU_MERCHANT_KEY
    const payuSalt = process.env.PAYU_MERCHANT_SALT
    const payuMode = process.env.PAYU_MODE || "test"

    if (!payuKey || !payuSalt) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "PayU is not configured")
    }

    const txnid = `sub_${partner.id.slice(-8)}_${Date.now()}`
    const amount = plan.price.toFixed(2)
    const productinfo = `${plan.name} Plan - ${plan.interval}`
    const firstname = partner.admins?.[0]?.first_name || partner.name || "Partner"
    const email = partner.admins?.[0]?.email || ""
    const phone = partner.admins?.[0]?.phone || ""

    // Store pending subscription info so the callback can activate it
    const pendingPayment = await service.createSubscriptionPayments({
      amount: plan.price,
      currency_code: plan.currency_code || "inr",
      status: SubscriptionPaymentStatus.PENDING,
      provider: "payu" as any,
      provider_reference_id: txnid,
      provider_data: { plan_id, partner_id: partner.id, txnid },
      period_start: new Date(),
      period_end: (() => { const d = new Date(); d.setMonth(d.getMonth() + 1); return d })(),
    })

    // Generate PayU hash
    const hashString = `${payuKey}|${txnid}|${amount}|${productinfo}|${firstname}|${email}|||||||||||${payuSalt}`
    const hash = crypto.createHash("sha512").update(hashString).digest("hex")

    const partnerUiUrl = process.env.PARTNER_UI_URL || "https://partner.jaalyantra.com"
    const backendUrl = process.env.MEDUSA_BACKEND_URL || "http://localhost:9000"

    const payuUrl = payuMode === "live"
      ? "https://secure.payu.in/_payment"
      : "https://test.payu.in/_payment"

    res.status(200).json({
      subscription: null,
      payment_url: payuUrl,
      payment_provider: "payu",
      payment_data: {
        key: payuKey,
        txnid,
        amount,
        productinfo,
        firstname,
        email,
        phone,
        hash,
        surl: `${backendUrl}/partners/subscription/payu/complete`,
        furl: `${backendUrl}/partners/subscription/payu/complete`,
        udf1: (pendingPayment as any).id,
        udf2: plan_id,
        udf3: partner.id,
      },
    })
    return
  }

  // Stripe flow
  if (provider === "stripe") {
    const stripeKey = process.env.STRIPE_API_KEY
    if (!stripeKey) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Stripe is not configured")
    }

    const partnerUiUrl = process.env.PARTNER_UI_URL || "https://partner.jaalyantra.com"

    // Create a Stripe Checkout Session
    const stripe = await import("stripe").then(m => new m.default(stripeKey))

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      currency: plan.currency_code || "usd",
      line_items: [{
        price_data: {
          currency: plan.currency_code || "usd",
          product_data: { name: `${plan.name} Plan - ${plan.interval}` },
          unit_amount: Math.round(plan.price * 100), // Stripe uses cents
        },
        quantity: 1,
      }],
      success_url: `${partnerUiUrl}/settings/plan?payment=success&plan_id=${plan_id}`,
      cancel_url: `${partnerUiUrl}/settings/plan?payment=canceled`,
      metadata: {
        partner_id: partner.id,
        plan_id,
        type: "partner_subscription",
      },
    })

    // Store pending payment
    await service.createSubscriptionPayments({
      amount: plan.price,
      currency_code: plan.currency_code || "usd",
      status: SubscriptionPaymentStatus.PENDING,
      provider: "stripe" as any,
      provider_reference_id: session.id,
      provider_data: { plan_id, partner_id: partner.id, session_id: session.id },
      period_start: new Date(),
      period_end: (() => { const d = new Date(); d.setMonth(d.getMonth() + 1); return d })(),
    })

    res.status(200).json({
      subscription: null,
      payment_url: session.url,
      payment_provider: "stripe",
    })
    return
  }

  throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Unknown payment provider")
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "No partner associated with this account")
  }

  const service: PartnerPlanService = req.scope.resolve(PARTNER_PLAN_MODULE)
  const [subscriptions] = await service.listAndCountPartnerSubscriptions(
    { partner_id: partner.id, status: "active" },
    { take: 1 }
  )

  if (!subscriptions.length) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "No active subscription found")
  }

  const { result, errors } = await cancelPartnerSubscriptionWorkflow(req.scope).run({
    input: { subscription_id: subscriptions[0].id },
  })

  if (errors.length > 0) throw errors[0]
  res.json(result)
}
