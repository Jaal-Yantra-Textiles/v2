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

      return {
        partner_ids: partnerIds,
        title:
          data.input.title?.trim() ||
          `What can you make for ${(data.design as any)?.name ?? "this design"}?`,
        spec_version: resolveSpecVersion(specifications),
        questions: generateInquiryQuestions({
          specifications,
          colours,
          categories: data.input.categories,
        }),
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

    return new WorkflowResponse(created)
  }
)
