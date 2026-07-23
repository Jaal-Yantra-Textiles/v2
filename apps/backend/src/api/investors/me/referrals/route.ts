import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { requireInvestor } from "../../helpers"
import { referralCreateSchema } from "../../validators"
import { INVESTOR_MODULE } from "../../../../modules/investor"
import type InvestorService from "../../../../modules/investor/service"
import { sendNotificationEmailWorkflow } from "../../../../workflows/email"

// The team address that fields investor referrals. Overridable via env.
const TEAM_EMAIL = process.env.INVESTOR_TEAM_EMAIL || "investors@jaalyantra.com"
const PORTAL_URL =
  process.env.INVESTOR_PORTAL_URL || "https://invest.jaalyantra.com"

// GET /investors/me/referrals — the invites this investor has sent.
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const investor = await requireInvestor(req.auth_context, req.scope)
  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)
  const referrals = await service.listReferrals(
    { referrer_investor_id: investor.id } as any,
    { order: { created_at: "DESC" } } as any
  )
  res.json({ referrals, count: referrals.length })
}

// POST /investors/me/referrals — invite a friend / other investor. Persists the
// referral, emails the team to follow up, and sends the invitee a friendly
// heads-up (no self-signup — onboarding stays invite-only). Emails are
// fire-and-log so a template/config gap never fails the 201.
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const investor = await requireInvestor(req.auth_context, req.scope)
  const data = referralCreateSchema.parse(req.body)
  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

  const referrer_name = investor.name || investor.email || "An investor"

  const referral = await service.createReferrals({
    referrer_investor_id: investor.id,
    company_id: data.company_id ?? null,
    name: data.name,
    email: data.email,
    note: data.note ?? null,
    access_level: data.access_level,
    status: "invited",
    metadata: { referrer_email: investor.email ?? null },
  } as any)

  const accessLabel =
    data.access_level === "view_only" ? "View-only" : "Investor"

  // Notify the team (follow-up lead).
  try {
    await sendNotificationEmailWorkflow(req.scope).run({
      input: {
        to: TEAM_EMAIL,
        template: "investor-referral-team",
        data: {
          referrer_name,
          referrer_email: investor.email ?? "",
          invitee_name: data.name,
          invitee_email: data.email,
          access_level: accessLabel,
          note: data.note ?? "",
          current_year: String(new Date().getFullYear()),
        },
      },
    })
  } catch (e: any) {
    logger.error(`[referrals] team email failed: ${e?.message || e}`)
  }

  // Heads-up to the invitee (no signup link — the team reaches out).
  try {
    await sendNotificationEmailWorkflow(req.scope).run({
      input: {
        to: data.email,
        template: "investor-referral-friend",
        data: {
          invitee_name: data.name,
          referrer_name,
          access_level: accessLabel,
          note: data.note ?? "",
          portal_url: PORTAL_URL,
          current_year: String(new Date().getFullYear()),
        },
      },
    })
  } catch (e: any) {
    logger.error(`[referrals] invitee email failed: ${e?.message || e}`)
  }

  res.status(201).json({ referral })
}
