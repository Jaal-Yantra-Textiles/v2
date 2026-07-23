/**
 * capture_contact — AI SDK tool for the storefront chat agent.
 *
 * When a shopper volunteers their name + email in the conversation (so the
 * team can follow up about pieces they liked), this persists them as a lead:
 * an upsert into the `person` module keyed on the unique email, tagged
 * `metadata.source = "storefront_chat"`. That source lets the audience
 * classifier ([[audience]] grouping, #881) fold the contact into the
 * organic-lead segment without any bespoke lead table.
 *
 * Mirrors the container-bound tool factory pattern of
 * `storefront-search-products.ts` and the race-safe person upsert of
 * `workflows/ad-planning/conversions/track-purchase-conversion.ts`.
 *
 * The model is instructed (see `storefront-chat.ts`) to call this ONCE, only
 * after the shopper has actually shared an email — never speculatively.
 */
import type { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { tool } from "ai"
import { z } from "zod"
import { PERSON_MODULE } from "../../../modules/person"
import { splitName } from "../../../workflows/leads/lib/email-lead"

/** Acquisition source stamped on people captured through the storefront chat. */
export const STOREFRONT_CHAT_LEAD_SOURCE = "storefront_chat"

const CaptureArgsSchema = z.object({
  email: z
    .string()
    .email()
    .max(200)
    .describe("The shopper's email address, exactly as they typed it."),
  name: z
    .string()
    .min(1)
    .max(120)
    .optional()
    .describe("The shopper's name, if they gave one."),
  interest: z
    .string()
    .max(280)
    .optional()
    .describe(
      "A short note on which pieces or topics the shopper was interested in, for follow-up context."
    ),
})

export type CaptureContactArgs = z.infer<typeof CaptureArgsSchema>

export type CaptureContactResult = {
  saved: boolean
  already_known?: boolean
}

/**
 * Upsert a storefront-chat lead into the `person` module. Exported separately
 * from the tool wrapper so it's unit-testable without the AI-SDK plumbing
 * (mirrors the `run*` helpers in `storefront-catalog-tools.ts`).
 */
export const runCaptureContact = async (
  args: CaptureContactArgs,
  container: MedusaContainer,
  visitorId?: string
): Promise<CaptureContactResult> => {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  const personService: any = container.resolve(PERSON_MODULE)

  const normalizedEmail = args.email.trim().toLowerCase()
  const { first_name, last_name } = splitName(args.name)
  const { interest } = args

  try {
    const existing = await personService.listPeople({ email: normalizedEmail })

    if (existing?.length > 0) {
      // Already a known person — enrich a missing name and record the
      // touchpoint, but never overwrite an existing acquisition source.
      const person = existing[0]
      const metadata: Record<string, unknown> = { ...(person.metadata || {}) }
      if (!metadata.source) metadata.source = STOREFRONT_CHAT_LEAD_SOURCE
      if (visitorId) metadata.visitor_id = visitorId
      if (interest) metadata.interest = interest

      await personService.updatePeople({
        id: person.id,
        ...(first_name && !person.first_name ? { first_name } : {}),
        ...(last_name && !person.last_name ? { last_name } : {}),
        metadata,
      })
      return { saved: true, already_known: true }
    }

    await personService.createPeople({
      first_name: first_name || "",
      last_name: last_name || "",
      email: normalizedEmail,
      metadata: {
        source: STOREFRONT_CHAT_LEAD_SOURCE,
        ...(visitorId ? { visitor_id: visitorId } : {}),
        ...(interest ? { interest } : {}),
      },
    })
    return { saved: true, already_known: false }
  } catch (e: any) {
    // A concurrent turn may win the unique-email race — re-read and reuse.
    try {
      const retry = await personService.listPeople({ email: normalizedEmail })
      if (retry?.length > 0) return { saved: true, already_known: true }
    } catch {
      /* fall through to the failure path */
    }
    logger?.warn?.(
      `[store/ai/chat] capture_contact failed for ${normalizedEmail}: ${e?.message ?? e}`
    )
    return { saved: false }
  }
}

export const createCaptureContactTool = (
  container: MedusaContainer,
  visitorId?: string
) =>
  tool({
    description:
      "Save the shopper's name and email as a follow-up lead. Call this ONCE, and only after the shopper has actually shared an email address in the conversation — never before they've given one. It returns whether the contact was saved.",
    inputSchema: CaptureArgsSchema,
    execute: async (args) => runCaptureContact(args, container, visitorId),
  })
