import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  createStep,
  WorkflowResponse,
  StepResponse,
  createWorkflow,
  transform
} from "@medusajs/framework/workflows-sdk"
import { DESIGN_MODULE } from "../../../modules/designs"
import { MedusaError } from "@medusajs/utils"
import { LinkDefinition } from "@medusajs/framework/types"
import { PARTNER_MODULE } from "../../../modules/partner"
import { DesignPartnerStageRole } from "../../../modules/designs/partner-stage-roles"
import designPartnersLink from "../../../links/design-partners-link"
import PartnerService from "../../../modules/partner/service"
import { notifyOnFailureStep, sendNotificationsStep } from "@medusajs/medusa/core-flows"

/**
 * One roster entry. `stage_role` omitted = leave an existing partner's stage
 * alone (a new partner gets none); `null` = clear it (#2306 S1).
 */
export type DesignPartnerRosterEntry = {
  partner_id: string
  stage_role?: DesignPartnerStageRole | null
}

type LinkDesignPartnerInput = {
  design_id: string
  partners: DesignPartnerRosterEntry[]
}

/** The link's own columns — kept whole when a stage change replaces the row. */
const LINK_COLUMNS = [
  "role",
  "stage_role",
  "sla_days",
  "performance_score",
  "transaction_id",
  "metadata",
] as const

type LinkRow = { partner_id: string } & Partial<
  Record<(typeof LINK_COLUMNS)[number], unknown>
>

const pairFor = (designId: string, partnerId: string): LinkDefinition => ({
  [DESIGN_MODULE]: { design_id: designId },
  [PARTNER_MODULE]: { partner_id: partnerId },
})

const columnsOf = (row: LinkRow) =>
  Object.fromEntries(LINK_COLUMNS.map((c) => [c, row[c] ?? null]))

const validatePartnersStep = createStep(
  "validate-partners-step",
  async (input: { partner_ids: string[] }, { container }) => {
    const partnerService: PartnerService = container.resolve(PARTNER_MODULE)

    const partners = await Promise.all(
      input.partner_ids.map(async (id) => {
        const partner = await partnerService.retrievePartner(id)
        if (!partner) {
          throw new MedusaError(
            MedusaError.Types.NOT_FOUND,
            `Partner with id ${id} not found`
          )
        }
        return partner
      })
    )

    return new StepResponse(partners)
  }
)

type LinkCompensation = {
  created: LinkDefinition[]
  /** Rows whose stage changed, with every column as it was before. */
  replaced: { partner_id: string; before: Record<string, unknown> }[]
  design_id: string
}

/**
 * Writes the roster. A new partner is linked; a partner already on it is only
 * touched when the entry names a `stage_role` that differs from theirs.
 *
 * `link.create` refuses a pair that already exists, so a stage change replaces
 * the row (dismiss + create) — carrying every other column across, because
 * `role` there is `prospect`/`maker`/`designer` and the inquiry-close step
 * dismisses by it. Same pattern as close-design-inquiry.ts.
 *
 * Nothing here messages a partner: adding someone to the roster is not
 * commissioning them (assign ≠ send).
 */
const createDesignPartnerLinksStep = createStep(
  "create-design-partner-links-step",
  async (input: LinkDesignPartnerInput, { container }) => {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const remoteLink: any = container.resolve(ContainerRegistrationKeys.LINK)

    const { data: existing } = await query.graph({
      entity: designPartnersLink.entryPoint,
      filters: { design_id: input.design_id },
      fields: ["partner_id", ...LINK_COLUMNS],
    })
    const byPartner = new Map<string, LinkRow>(
      ((existing ?? []) as LinkRow[])
        .filter((l) => l?.partner_id)
        .map((l) => [l.partner_id, l])
    )

    const toCreate: LinkDefinition[] = []
    const toReplace: { partner_id: string; before: Record<string, unknown>; after: Record<string, unknown> }[] = []
    const seen = new Set<string>()

    for (const entry of input.partners) {
      if (!entry.partner_id || seen.has(entry.partner_id)) continue
      seen.add(entry.partner_id)

      const current = byPartner.get(entry.partner_id)
      if (!current) {
        toCreate.push({
          ...pairFor(input.design_id, entry.partner_id),
          ...(entry.stage_role ? { data: { stage_role: entry.stage_role } } : {}),
        })
        continue
      }

      if (entry.stage_role === undefined) continue
      if ((current.stage_role ?? null) === entry.stage_role) continue

      const before = columnsOf(current)
      toReplace.push({
        partner_id: entry.partner_id,
        before,
        after: { ...before, stage_role: entry.stage_role },
      })
    }

    if (toCreate.length) {
      await remoteLink.create(toCreate)
    }
    for (const r of toReplace) {
      const pair = pairFor(input.design_id, r.partner_id)
      await remoteLink.dismiss([pair])
      await remoteLink.create([{ ...pair, data: r.after }])
    }

    const compensation: LinkCompensation = {
      design_id: input.design_id,
      created: toCreate.map((l: any) =>
        pairFor(input.design_id, l[PARTNER_MODULE].partner_id)
      ),
      replaced: toReplace.map(({ partner_id, before }) => ({ partner_id, before })),
    }

    return new StepResponse(
      {
        linked: compensation.created.map((l: any) => l[PARTNER_MODULE].partner_id) as string[],
        stage_changed: toReplace.map((r) => r.partner_id),
      },
      compensation
    )
  },
  async (comp: LinkCompensation | undefined, { container }) => {
    if (!comp) {
      return
    }
    const remoteLink: any = container.resolve(ContainerRegistrationKeys.LINK)
    if (comp.created.length) {
      await remoteLink.dismiss(comp.created)
    }
    for (const r of comp.replaced) {
      const pair = pairFor(comp.design_id, r.partner_id)
      await remoteLink.dismiss([pair])
      await remoteLink.create([{ ...pair, data: r.before }])
    }
  }
)

export const linkDesignPartnerWorkflow = createWorkflow(
  "link-design-partner-workflow",
  (input: LinkDesignPartnerInput) => {
    // Failure notification to admin feed
    const failureNotification = transform({ input }, (data) => {
      return [
        {
          to: "",
          channel: "feed",
          template: "admin-ui",
          data: {
            title: "Design Partner Link",
            description: `Failed to link design ${data.input.design_id} to partner(s) ${data.input.partners.map((p) => p.partner_id).join(", ")}. The link may have been rolled back.`,
          },
        },
      ]
    })
    notifyOnFailureStep(failureNotification)
    const partnerIds = transform({ input }, ({ input }) =>
      input.partners.map((p) => p.partner_id)
    )
    validatePartnersStep({ partner_ids: partnerIds })

    const links = createDesignPartnerLinksStep(input)

    // Success notification
    const successNotification = transform({ input }, (data) => {
      return [
        {
          to: "",
          channel: "feed",
          template: "admin-ui",
          data: {
            title: "Design Partner Link",
            description: `Linked design ${data.input.design_id} to partner(s) ${data.input.partners.map((p) => p.partner_id).join(", ")}.`,
          },
        },
      ]
    })
    sendNotificationsStep(successNotification)

    return new WorkflowResponse(links)
  }
)