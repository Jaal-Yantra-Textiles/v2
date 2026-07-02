import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { logger } from "@medusajs/framework"
import { getPartnerFromAuthContext } from "../../helpers"
import { PARTNER_PAYMENT_CONFIG_MODULE } from "../../../../modules/partner-payment-config"
import {
  STRIPE_PROVIDER_ID,
  getPlatformStripe,
  accountToConnectFields,
  assertSafeUrl,
} from "../../../../modules/partner-payment-config/lib/stripe-connect"

/**
 * Shape returned to the partner UI describing their Connect state.
 */
const toStatusPayload = (config: any) => ({
  connected: !!config?.connect_account_id,
  account_id: config?.connect_account_id ?? null,
  status: config?.connect_status ?? null,
  charges_enabled: !!config?.connect_charges_enabled,
  payouts_enabled: !!config?.connect_payouts_enabled,
  details_submitted: !!config?.connect_details_submitted,
})

const getStripeConfig = async (configService: any, partnerId: string) => {
  const configs = await configService.listPartnerPaymentConfigs({
    partner_id: partnerId,
    provider_id: STRIPE_PROVIDER_ID,
  })
  return configs?.[0] || null
}

/**
 * GET /partners/payment-config/stripe-connect
 *
 * Returns the partner's current Stripe Connect status. When a connected
 * account exists, we live-sync from Stripe (so returning from the hosted
 * onboarding flow reflects charges_enabled immediately, without waiting for
 * the async account.updated webhook).
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Partner not found")
  }

  const configService = req.scope.resolve(PARTNER_PAYMENT_CONFIG_MODULE) as any
  let config = await getStripeConfig(configService, partner.id)

  if (config?.connect_account_id) {
    try {
      const stripe = await getPlatformStripe()
      const account = await stripe.accounts.retrieve(config.connect_account_id)
      const fields = accountToConnectFields(account)
      config = await configService.updatePartnerPaymentConfigs({
        id: config.id,
        ...fields,
      })
    } catch (e: any) {
      // Non-fatal: fall back to the persisted snapshot.
      logger.warn(
        `[stripe-connect] live sync failed for ${config.connect_account_id}: ${e?.message}`
      )
    }
  }

  res.json({ stripe_connect: toStatusPayload(config) })
}

/**
 * POST /partners/payment-config/stripe-connect
 *
 * Creates (or reuses) a Standard connected account for the partner and returns
 * a Stripe-hosted onboarding link. The partner is redirected to `url`.
 *
 * Body: { return_url, refresh_url } — both point back to the partner UI
 * (the UI passes its own settings page URL, so no server-side origin guessing).
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Partner not found")
  }

  const body = (req.body ?? {}) as { return_url?: string; refresh_url?: string }
  const returnUrl = assertSafeUrl(body.return_url, "return_url")
  const refreshUrl = assertSafeUrl(body.refresh_url ?? body.return_url, "refresh_url")

  const configService = req.scope.resolve(PARTNER_PAYMENT_CONFIG_MODULE) as any
  const stripe = await getPlatformStripe()

  let config = await getStripeConfig(configService, partner.id)
  let accountId = config?.connect_account_id as string | undefined

  // Create the Standard account once; reuse it on subsequent "resume" clicks.
  if (!accountId) {
    const account = await stripe.accounts.create({
      type: "standard",
      email: (partner as any).contact_email || (partner as any).email || undefined,
      metadata: {
        partner_id: partner.id,
        partner_name: (partner as any).name || "",
        source: "jyt_partner_portal",
      },
    })
    accountId = account.id

    const connectFields = {
      connect_account_id: accountId,
      connect_status: "pending",
      connect_charges_enabled: false,
      connect_payouts_enabled: false,
      connect_details_submitted: false,
    }

    if (config) {
      config = await configService.updatePartnerPaymentConfigs({
        id: config.id,
        ...connectFields,
      })
    } else {
      config = await configService.createPartnerPaymentConfigs({
        partner_id: partner.id,
        provider_id: STRIPE_PROVIDER_ID,
        // No manual keys — Connect is the source. Kept as {} so the JSON
        // column is never null.
        credentials: {},
        is_active: true,
        ...connectFields,
      })
    }

    logger.info(
      `[stripe-connect] created Standard account ${accountId} for partner ${partner.id}`
    )
  }

  const link = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: "account_onboarding",
  })

  res.json({ url: link.url, account_id: accountId })
}
