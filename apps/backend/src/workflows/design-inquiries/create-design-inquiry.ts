import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  transform,
} from "@medusajs/framework/workflows-sdk"
import type { LinkDefinition } from "@medusajs/framework/types"

import { DESIGN_MODULE } from "../../modules/designs"
import { PARTNER_MODULE } from "../../modules/partner"
import { DESIGN_INQUIRY_MODULE } from "../../modules/design_inquiry"
import type DesignInquiryService from "../../modules/design_inquiry/service"
import designPartnersLink from "../../links/design-partners-link"
import { SOCIAL_PROVIDER_MODULE } from "../../modules/social-provider"
import { generatePartnerDeeplink } from "../../modules/social-provider/whatsapp-deeplink"
import { DESIGN_INQUIRY_TEMPLATE_NAMES } from "../../scripts/whatsapp-templates/design-inquiry-templates"
import {
  generateInquiryQuestions,
  resolveSpecVersion,
  type InquiryPaletteValue,
} from "./generate-questions"

/**
 * Ask a set of partners what they can make for a design (#1531).
 *
 * One inquiry, many partners, one generated set of questions — so two partners'
 * answers are comparable side by side, which is the thing a WhatsApp thread per
 * partner could never give.
 */

export type CreateDesignInquiryInput = {
  design_id: string
  partner_ids: string[]
  title?: string
  brief_note?: string
  /** media_file ids for the references being shown to every invited partner. */
  reference_media_ids?: string[]
  /** Restrict the wizard to these spec categories. Absent = all of them. */
  categories?: string[]
  created_by?: string
}

/** The prospect grant. See `closeDesignInquiryWorkflow` for why it is temporary. */
export const PROSPECT_ROLE = "prospect"

const loadDesignForInquiryStep = createStep(
  "load-design-for-inquiry",
  async (input: { design_id: string }, { container }) => {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

    const {
      data: [design],
    } = await query.graph({
      entity: "design",
      fields: ["id", "name", "specifications.*", "colors.*"],
      filters: { id: input.design_id },
    })

    if (!design) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Design ${input.design_id} not found`
      )
    }

    return new StepResponse(design)
  }
)

const createInquiryStep = createStep(
  "create-design-inquiry",
  async (
    input: {
      design_id: string
      title: string
      brief_note?: string | null
      reference_media_ids?: string[] | null
      spec_version: string | null
      created_by?: string | null
      partner_ids: string[]
      questions: Array<Record<string, any>>
    },
    { container }
  ) => {
    const service: DesignInquiryService = container.resolve(DESIGN_INQUIRY_MODULE)

    const inquiry = await service.createDesignInquiries({
      design_id: input.design_id,
      title: input.title,
      brief_note: input.brief_note ?? null,
      reference_media_ids: input.reference_media_ids?.length
        ? input.reference_media_ids
        : null,
      spec_version: input.spec_version,
      created_by: input.created_by ?? null,
      status: "open",
    } as any)

    const inquiryId = (inquiry as any).id

    const questions = input.questions.length
      ? await service.createDesignInquiryQuestions(
          input.questions.map((q) => ({ ...q, inquiry_id: inquiryId })) as any
        )
      : []

    /**
     * A response row per invited partner, created NOW and empty.
     *
     * So that a partner who never answers is visible as silence rather than
     * simply absent — "three asked, one replied" is a fact worth being able to
     * read off the comparison, and a row created only on submission cannot
     * express it.
     */
    const responses = await service.createDesignInquiryResponses(
      input.partner_ids.map((partner_id) => ({
        inquiry_id: inquiryId,
        partner_id,
        invited_at: new Date(),
      })) as any
    )

    return new StepResponse(
      {
        inquiry,
        questions: Array.isArray(questions) ? questions : [questions],
        responses: Array.isArray(responses) ? responses : [responses],
      },
      { inquiryId }
    )
  },
  async (rollback: { inquiryId?: string } | undefined, { container }) => {
    if (!rollback?.inquiryId) return
    const service: DesignInquiryService = container.resolve(DESIGN_INQUIRY_MODULE)
    // Questions and responses cascade off the inquiry.
    await service.deleteDesignInquiries(rollback.inquiryId)
  }
)

/**
 * Grant each invited partner access to the design.
 *
 * Reuses `design_partners_link` — the same link the partner design routes
 * already authorize against — so no new authorization code is needed for a
 * prospect to read the brief or upload against it. Stamped with a `prospect`
 * role so the grant can be told apart from a real assignment and withdrawn when
 * the inquiry closes.
 *
 * 🔴 `link.create` is not idempotent: it refuses a pair that already exists. An
 * existing link is left exactly as it is — a partner already working on this
 * design must not be downgraded to `prospect` by being asked a question.
 */
const grantProspectAccessStep = createStep(
  "grant-inquiry-prospect-access",
  async (
    input: { design_id: string; partner_ids: string[] },
    { container }
  ) => {
    if (!input.partner_ids.length) {
      return new StepResponse({ created: 0, already_linked: 0 }, [])
    }

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const remoteLink: any = container.resolve(ContainerRegistrationKeys.LINK)

    const { data: existing } = await query.graph({
      entity: designPartnersLink.entryPoint,
      filters: { design_id: input.design_id },
      fields: ["partner_id"],
    })
    const linked = new Set<string>(
      (existing ?? []).map((l: any) => l.partner_id).filter(Boolean)
    )

    const toCreate: LinkDefinition[] = []
    let alreadyLinked = 0
    for (const partnerId of input.partner_ids) {
      if (!partnerId || linked.has(partnerId)) {
        if (partnerId) alreadyLinked++
        continue
      }
      toCreate.push({
        [DESIGN_MODULE]: { design_id: input.design_id },
        [PARTNER_MODULE]: { partner_id: partnerId },
        data: { role: PROSPECT_ROLE },
      })
      linked.add(partnerId)
    }

    if (toCreate.length) {
      await remoteLink.create(toCreate)
    }

    return new StepResponse(
      { created: toCreate.length, already_linked: alreadyLinked },
      toCreate
    )
  },
  async (links: LinkDefinition[] | undefined, { container }) => {
    if (!links?.length) return
    const remoteLink: any = container.resolve(ContainerRegistrationKeys.LINK)
    await remoteLink.dismiss(links)
  }
)

/**
 * Knock on WhatsApp, once, with a link that lands them in the wizard (#1531
 * slice 3).
 *
 * ## Why this is a template and not a message
 *
 * Meta's 24-hour window constrains BUSINESS-initiated messages, and an inquiry
 * is business-initiated by definition — we are asking about a design they have
 * never seen, usually weeks since either of us last said anything. A free-form
 * message would not deliver at all.
 *
 * 🔑 Any inbound reply reopens the window for 24 hours, free and with no
 * template. Only the first knock has to be one.
 *
 * ## Why the link carries a token instead of an id
 *
 * The approved template's URL is static per Meta, so it cannot name the
 * inquiry. The `wa_token` does: its claims carry the partner AND the inquiry,
 * `/partners/wa-auth` exchanges it for a session and returns
 * `/inquiries/<id>`, and partner-ui navigates there. So a partner who gets
 * round to it three days later still lands on the right wizard with no
 * password — which matters more here than anywhere else, because they did not
 * ask for this and any friction reads as a no.
 *
 * ## 🔴 Non-fatal, and it says what it actually did
 *
 * The inquiry exists whether or not WhatsApp accepted the message, and losing
 * a whole sourcing round because one partner's number is stale would be far
 * worse than an un-notified invite — they can still be told by hand.
 *
 * But a swallowed failure here is the worst kind: the invite looks sent, the
 * partner never hears, and their silence gets read as disinterest. So every
 * outcome is counted and returned. `jyt_design_inquiry_invite_v1` is also NOT
 * approved by Meta merely by existing in the spec file — until the sync runs
 * and Meta approves, EVERY send fails, and `notified: 0` is the only thing
 * that will say so.
 */
const notifyInvitedPartnersStep = createStep(
  "notify-inquiry-partners",
  async (
    input: {
      inquiry_id: string
      partner_ids: string[]
      design_name: string
      question_count: number
    },
    { container }
  ) => {
    const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)

    const result = {
      notified: 0,
      no_whatsapp_number: 0,
      failed: 0,
      skipped_reason: null as string | null,
    }

    if (!input.partner_ids?.length) return new StepResponse(result)

    let whatsapp: any
    try {
      const socialProvider: any = container.resolve(SOCIAL_PROVIDER_MODULE)
      whatsapp = socialProvider.getWhatsApp(container as any)
    } catch (e: any) {
      // WhatsApp not configured in this environment — a real state locally and
      // in tests, and not a reason to fail creating an inquiry.
      result.skipped_reason = `WhatsApp is not configured: ${e?.message ?? String(e)}`
      logger?.warn?.(`[design-inquiry] ${result.skipped_reason}`)
      return new StepResponse(result)
    }

    const partnerService: any = container.resolve(PARTNER_MODULE)
    const lang = process.env.WHATSAPP_TEMPLATE_LANG || "hi"
    const base = (
      process.env.PARTNER_PORTAL_URL || "https://partner.jaalyantra.com"
    ).replace(/\/$/, "")

    for (const partnerId of input.partner_ids) {
      let partner: any = null
      try {
        partner = await partnerService.retrievePartner(partnerId)
      } catch {
        partner = null
      }

      const phone = partner?.whatsapp_number
      if (!phone || !partner?.whatsapp_verified) {
        // Counted, not silent. A partner we cannot reach is a partner whose
        // silence means nothing, and whoever reads the comparison needs to
        // know which kind of silence they are looking at.
        result.no_whatsapp_number++
        logger?.warn?.(
          `[design-inquiry] ${input.inquiry_id}: partner ${partnerId} has no verified WhatsApp number — not notified`
        )
        continue
      }

      try {
        const { token } = generatePartnerDeeplink(
          {
            partner_id: partnerId,
            run_id: input.inquiry_id,
            type: "inquiry",
          },
          base
        )

        await whatsapp.sendTemplateMessage(
          phone,
          DESIGN_INQUIRY_TEMPLATE_NAMES.INQUIRY_INVITE,
          lang,
          [
            {
              type: "body",
              parameters: [
                { type: "text", text: partner?.name || "Partner" },
                { type: "text", text: input.design_name },
                { type: "text", text: String(input.question_count) },
              ],
            },
            {
              // The dynamic URL button's {{1}}. `index` is coerced to a string
              // at the service boundary, as Meta's wire format requires.
              type: "button",
              sub_type: "url",
              index: 0,
              parameters: [{ type: "text", text: token }],
            },
          ]
        )
        result.notified++
      } catch (e: any) {
        result.failed++
        logger?.warn?.(
          `[design-inquiry] ${input.inquiry_id}: invite to ${partnerId} failed: ${e?.message ?? String(e)}`
        )
      }
    }

    logger?.info?.(
      `[design-inquiry] ${input.inquiry_id}: notified ${result.notified}, ` +
        `${result.no_whatsapp_number} without WhatsApp, ${result.failed} failed`
    )

    return new StepResponse(result)
  }
  // 🔑 No compensation. A WhatsApp message cannot be unsent, and pretending
  // otherwise would be worse than admitting it: if a later step rolls the
  // inquiry back, the partner has still been asked. That is the argument for
  // this step running LAST.
)

export const createDesignInquiryWorkflow = createWorkflow(
  "create-design-inquiry",
  (input: CreateDesignInquiryInput) => {
    const design = loadDesignForInquiryStep({ design_id: input.design_id })

    const prepared = transform({ input, design }, (data) => {
      const specifications = (data.design as any)?.specifications ?? []

      /**
       * The design's OWN colours, not the shared product palette: this asks
       * "can you do the colours this design calls for", and answering it from a
       * platform-wide palette would put 55 swatches in front of a partner, of
       * which the design uses four.
       */
      const colours: InquiryPaletteValue[] = ((data.design as any)?.colors ?? [])
        .map((c: any) => ({
          id: c?.id ?? null,
          value: c?.name ?? "",
          hex: c?.hex_code ?? null,
        }))

      const partnerIds = Array.from(
        new Set(
          (data.input.partner_ids || []).filter(
            (id): id is string => typeof id === "string" && id.length > 0
          )
        )
      )

      const questions = generateInquiryQuestions({
        specifications,
        colours,
        categories: data.input.categories,
      })

      return {
        partner_ids: partnerIds,
        design_name: (data.design as any)?.name ?? "a new design",
        question_count: questions.length,
        title:
          data.input.title?.trim() ||
          `What can you make for ${(data.design as any)?.name ?? "this design"}?`,
        spec_version: resolveSpecVersion(specifications),
        questions,
      }
    })

    const created = createInquiryStep({
      design_id: input.design_id,
      title: prepared.title,
      brief_note: input.brief_note,
      reference_media_ids: input.reference_media_ids,
      spec_version: prepared.spec_version,
      created_by: input.created_by,
      partner_ids: prepared.partner_ids,
      questions: prepared.questions,
    })

    grantProspectAccessStep({
      design_id: input.design_id,
      partner_ids: prepared.partner_ids,
    })

    /**
     * LAST, deliberately. The grant has to exist before the partner can be
     * told to go and look — a message arriving before the access it promises
     * lands the partner on a 404, and they do not knock twice.
     */
    const notified = notifyInvitedPartnersStep({
      inquiry_id: created.inquiry.id,
      partner_ids: prepared.partner_ids,
      design_name: prepared.design_name,
      question_count: prepared.question_count,
    })

    return new WorkflowResponse(
      transform({ created, notified }, (data) => ({
        ...(data.created as any),
        notifications: data.notified,
      }))
    )
  }
)
