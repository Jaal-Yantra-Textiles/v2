import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { PARTNER_MODULE } from "../../../modules/partner"
import { SOCIAL_PROVIDER_MODULE } from "../../../modules/social-provider"
import type SocialProviderService from "../../../modules/social-provider/service"

// In-memory OTP store (use Redis in production for multi-instance)
const otpStore = new Map<string, { code: string; phone: string; expiresAt: number }>()

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

/**
 * POST /partners/whatsapp-verify
 *
 * Step 1: Send an OTP to the provided WhatsApp number.
 * Body: { phone: "393933806825" }
 */
export const POST = async (
  req: AuthenticatedMedusaRequest & { body: { phone?: string; code?: string } },
  res: MedusaResponse
) => {
  const partnerId = req.auth_context?.actor_id
  if (!partnerId) {
    return res.status(401).json({ error: "Partner authentication required" })
  }

  const { phone, code } = req.body

  // If code is provided, this is Step 2 (verification)
  if (code) {
    return verifyOtp(req, res, partnerId, code)
  }

  // Step 1: Send OTP
  if (!phone) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Phone number is required. Provide { phone: \"<number>\" }"
    )
  }

  // Normalize phone: strip non-digits
  const normalized = phone.replace(/[^0-9]/g, "")
  if (normalized.length < 10) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Invalid phone number. Include country code, e.g. 393933806825"
    )
  }

  const otp = generateOtp()
  const expiresAt = Date.now() + 10 * 60 * 1000 // 10 minutes

  otpStore.set(partnerId, { code: otp, phone: normalized, expiresAt })

  // Send OTP via WhatsApp
  try {
    const socialProvider = req.scope.resolve(SOCIAL_PROVIDER_MODULE) as SocialProviderService
    const whatsapp = socialProvider.getWhatsApp(req.scope)

    await whatsapp.sendTextMessage(
      normalized,
      `🔐 *JYT WhatsApp Verification*\n\nYour verification code is: *${otp}*\n\nThis code expires in 10 minutes.\nDo not share this code with anyone.`
    )
  } catch (e: any) {
    otpStore.delete(partnerId)
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Failed to send OTP to ${normalized}: ${e.message}`
    )
  }

  return res.json({
    message: "Verification code sent to your WhatsApp number",
    phone: normalized,
    expires_in: 600, // seconds
  })
}

/**
 * Step 2: Verify the OTP code and mark the number as verified.
 */
async function verifyOtp(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
  partnerId: string,
  code: string
) {
  const stored = otpStore.get(partnerId)

  if (!stored) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "No pending verification. Send a phone number first."
    )
  }

  if (Date.now() > stored.expiresAt) {
    otpStore.delete(partnerId)
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Verification code expired. Please request a new one."
    )
  }

  if (stored.code !== code.trim()) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Invalid verification code. Please try again."
    )
  }

  // OTP is valid — update partner with verified WhatsApp number
  const partnerService = req.scope.resolve(PARTNER_MODULE) as any
  await partnerService.updatePartners({
    id: partnerId,
    whatsapp_number: stored.phone,
    whatsapp_verified: true,
  })

  otpStore.delete(partnerId)

  // Send confirmation via WhatsApp
  try {
    const socialProvider = req.scope.resolve(SOCIAL_PROVIDER_MODULE) as SocialProviderService
    const whatsapp = socialProvider.getWhatsApp(req.scope)

    await whatsapp.sendTextMessage(
      stored.phone,
      `✅ *WhatsApp number verified!*\n\nYou will now receive production run notifications on this number.\n\nSend *help* to see available commands.`
    )
  } catch {
    // Non-fatal — verification succeeded even if confirmation fails
  }

  return res.json({
    message: "WhatsApp number verified successfully",
    whatsapp_number: stored.phone,
    whatsapp_verified: true,
  })
}
