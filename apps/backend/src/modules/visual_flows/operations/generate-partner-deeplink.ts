import { z } from "@medusajs/framework/zod"
import { OperationDefinition, OperationContext, OperationResult } from "./types"
import { interpolateString } from "./utils"
import {
  generatePartnerDeeplink,
  type PartnerDeeplinkType,
} from "../../social-provider/whatsapp-deeplink"

/**
 * Generate a short-lived signed URL that a partner can tap from WhatsApp to
 * land in the portal already authenticated — no password prompt. Wraps
 * generatePartnerDeeplink() so visual flows don't need to sign JWTs in an
 * execute_code sandbox.
 *
 * Output:
 *   { url, token }
 *
 * The token encodes partner_id + optional run_id + link type and expires in
 * 24 hours (set in whatsapp-deeplink.ts). Route /partners/wa-auth validates
 * the token and issues the session.
 */
export const generatePartnerDeeplinkOperation: OperationDefinition = {
  type: "generate_partner_deeplink",
  name: "Generate Partner Deep-Link",
  description:
    "Create a one-tap authenticated URL for the partner portal. Pairs with the " +
    "/partners/wa-auth endpoint so partners land in context without logging in.",
  icon: "link",
  category: "utility",

  optionsSchema: z.object({
    partner_id: z
      .string()
      .min(1)
      .describe("Partner ID. Supports {{ }} interpolation."),
    run_id: z
      .string()
      .optional()
      .describe(
        'Optional run / design / inquiry ID to deep-link into. Ignored when type="portal".'
      ),
    type: z
      // ⚠️ This enum, `PartnerDeeplinkType` and `partnerDeeplinkPath` must
      // agree. The path function is the one that decides where a tap lands;
      // a type missing HERE simply cannot be chosen in a flow, which is a
      // visible failure — unlike a type missing from the path function, which
      // silently lands the partner on the portal home (#1531 slice 3).
      .enum(["production_run", "design", "portal", "inquiry"])
      .default("production_run")
      .describe("Deep-link type. Controls the landing route."),
    base_url: z
      .string()
      .optional()
      .describe(
        "Portal base URL (e.g. https://partner.jaalyantra.com). Defaults to " +
          "env PARTNER_PORTAL_URL, then to https://partner.jaalyantra.com."
      ),
  }),

  defaultOptions: {
    partner_id: "",
    type: "production_run",
  },

  execute: async (options, context: OperationContext): Promise<OperationResult> => {
    try {
      const partnerId = interpolateString(options.partner_id, context.dataChain).trim()
      if (!partnerId) {
        return {
          success: false,
          error: "partner_id is required for generate_partner_deeplink",
        }
      }

      const runId = options.run_id
        ? interpolateString(options.run_id, context.dataChain).trim() || undefined
        : undefined
      const type = (options.type ||
        "production_run") as PartnerDeeplinkType

      const baseUrl =
        (options.base_url
          ? interpolateString(options.base_url, context.dataChain).trim()
          : "") ||
        process.env.PARTNER_PORTAL_URL ||
        "https://partner.jaalyantra.com"

      const { url, token } = generatePartnerDeeplink(
        { partner_id: partnerId, run_id: runId, type },
        baseUrl,
      )

      return {
        success: true,
        data: { url, token, partner_id: partnerId, run_id: runId ?? null, type },
      }
    } catch (error: any) {
      return {
        success: false,
        error: error?.message ?? "Failed to generate deep-link",
        errorStack: error?.stack,
      }
    }
  },
}
