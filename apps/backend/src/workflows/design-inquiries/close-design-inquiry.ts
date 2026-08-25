import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import type { LinkDefinition } from "@medusajs/framework/types"

import { DESIGN_MODULE } from "../../modules/designs"
import { PARTNER_MODULE } from "../../modules/partner"
import { DESIGN_INQUIRY_MODULE } from "../../modules/design_inquiry"
import type DesignInquiryService from "../../modules/design_inquiry/service"
import designPartnersLink from "../../links/design-partners-link"
import { PROSPECT_ROLE } from "./create-design-inquiry"

/**
 * Close an inquiry and take the brief back (#1531).
 *
 * 🔴 The revocation is the point, not a tidy-up. Being asked a question granted
 * a partner read access to an unreleased design; leaving that access in place
 * means every partner ever shown a brief can still read it, forever. That is
 * the #1496 shape — a quote that rendered on every partner's storefront because
 * nothing revoked access — and it must not repeat on designs.
 *
 * Only links this flow created are withdrawn: a `prospect` link is one we
 * granted for the asking, while any other role means the partner was already
 * working on this design and must be left exactly as they were.
 */

export type CloseDesignInquiryInput = {
  inquiry_id: string
  /**
   * The partner who will make the sample. Their access is KEPT and promoted
   * from prospect to maker — they are about to be sent work, and taking the
   * brief away at the moment they win it would be absurd.
   */
  chosen_partner_id?: string | null
  /** Role stamped on the chosen partner's link. */
  chosen_role?: string
}

export const MAKER_ROLE = "maker"

const closeInquiryStep = createStep(
  "close-design-inquiry",
  async (input: { inquiry_id: string }, { container }) => {
    const service: DesignInquiryService = container.resolve(DESIGN_INQUIRY_MODULE)

    const inquiry = await service
      .retrieveDesignInquiry(input.inquiry_id)
      .catch(() => null)

    if (!inquiry) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Design inquiry ${input.inquiry_id} not found`
      )
    }

    const previousStatus = String((inquiry as any).status)

    const updated = await service.updateDesignInquiries({
      id: input.inquiry_id,
      status: "closed",
      closed_at: new Date(),
    } as any)

    return new StepResponse(
      { inquiry: updated, design_id: (inquiry as any).design_id },
      { inquiry_id: input.inquiry_id, previousStatus }
    )
  },
  async (
    rollback: { inquiry_id: string; previousStatus: string } | undefined,
    { container }
  ) => {
    if (!rollback) return
    const service: DesignInquiryService = container.resolve(DESIGN_INQUIRY_MODULE)
    await service.updateDesignInquiries({
      id: rollback.inquiry_id,
      status: rollback.previousStatus,
      closed_at: null,
    } as any)
  }
)

const revokeProspectAccessStep = createStep(
  "revoke-inquiry-prospect-access",
  async (
    input: {
      design_id: string
      chosen_partner_id?: string | null
      chosen_role?: string
    },
    { container }
  ) => {
    if (!input.design_id) {
      return new StepResponse(
        { revoked: [] as string[], promoted: null as string | null },
        { design_id: "", dismissed: [] as LinkDefinition[], promoted: null as string | null }
      )
    }

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const remoteLink: any = container.resolve(ContainerRegistrationKeys.LINK)

    const { data: links } = await query.graph({
      entity: designPartnersLink.entryPoint,
      filters: { design_id: input.design_id },
      fields: ["partner_id", "role"],
    })

    const prospects = (links ?? []).filter(
      (l: any) => String(l?.role) === PROSPECT_ROLE && l?.partner_id
    )

    const chosen = input.chosen_partner_id || null
    const toDismiss: LinkDefinition[] = []
    for (const link of prospects) {
      if (chosen && link.partner_id === chosen) continue
      toDismiss.push({
        [DESIGN_MODULE]: { design_id: input.design_id },
        [PARTNER_MODULE]: { partner_id: link.partner_id },
      })
    }

    if (toDismiss.length) {
      await remoteLink.dismiss(toDismiss)
    }

    /**
     * Promote the chosen partner by replacing the link, because the role lives
     * in the link's own columns and `link.create` refuses a pair that already
     * exists. Done AFTER the dismissals so a failure here leaves the winner
     * holding a prospect link — access they should have either way — rather
     * than none at all.
     */
    let promoted: string | null = null
    const chosenIsProspect =
      chosen && prospects.some((l: any) => l.partner_id === chosen)

    if (chosen && chosenIsProspect) {
      const pair = {
        [DESIGN_MODULE]: { design_id: input.design_id },
        [PARTNER_MODULE]: { partner_id: chosen },
      }
      await remoteLink.dismiss([pair as LinkDefinition])
      await remoteLink.create([
        { ...pair, data: { role: input.chosen_role || MAKER_ROLE } } as LinkDefinition,
      ])
      promoted = chosen
    }

    return new StepResponse(
      {
        revoked: toDismiss.map(
          (l: any) => l[PARTNER_MODULE].partner_id
        ) as string[],
        promoted: promoted as string | null,
      },
      {
        design_id: input.design_id,
        dismissed: toDismiss as LinkDefinition[],
        promoted: promoted as string | null,
      }
    )
  },
  async (
    rollback:
      | { design_id: string; dismissed: LinkDefinition[]; promoted: string | null }
      | undefined,
    { container }
  ) => {
    if (!rollback) return
    const remoteLink: any = container.resolve(ContainerRegistrationKeys.LINK)

    if (rollback.dismissed?.length) {
      await remoteLink.create(
        rollback.dismissed.map((l) => ({ ...l, data: { role: PROSPECT_ROLE } }))
      )
    }

    if (rollback.promoted) {
      const pair = {
        [DESIGN_MODULE]: { design_id: rollback.design_id },
        [PARTNER_MODULE]: { partner_id: rollback.promoted },
      }
      await remoteLink.dismiss([pair as LinkDefinition])
      await remoteLink.create([
        { ...pair, data: { role: PROSPECT_ROLE } } as LinkDefinition,
      ])
    }
  }
)

export const closeDesignInquiryWorkflow = createWorkflow(
  "close-design-inquiry",
  (input: CloseDesignInquiryInput) => {
    const closed = closeInquiryStep({ inquiry_id: input.inquiry_id })

    const access = revokeProspectAccessStep({
      design_id: closed.design_id,
      chosen_partner_id: input.chosen_partner_id,
      chosen_role: input.chosen_role,
    })

    return new WorkflowResponse({ inquiry: closed.inquiry, access })
  }
)
