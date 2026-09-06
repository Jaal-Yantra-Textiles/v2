import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
  transform,
  when,
} from "@medusajs/framework/workflows-sdk";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { dismissRemoteLinkStep } from "@medusajs/medusa/core-flows";
import type { LinkDefinition } from "@medusajs/framework/types";
import type { Link } from "@medusajs/framework/modules-sdk";
import DesignService from "../../modules/designs/service";
import { DESIGN_MODULE } from "../../modules/designs";
import { PARTNER_MODULE } from "../../modules/partner";
import designPartnersLink from "../../links/design-partners-link";

type DeleteDesignStepInput = {
  id: string;
};

export const deleteDesignStep = createStep(
  "delete-design-step",
  async (input: DeleteDesignStepInput, { container }) => {
    const designService: DesignService = container.resolve(DESIGN_MODULE);
    await designService.softDeleteDesigns(input.id);
    return new StepResponse({ id: input.id }, { id: input.id });
  },
  async (data: { id: string } | undefined, { container }) => {
    if (!data?.id) return;
    const designService: DesignService = container.resolve(DESIGN_MODULE);
    await designService.restoreDesigns(data.id);
  }
);

/**
 * Resolve the design ↔ partner link pairs so they can be dismissed
 * alongside the design delete. Without this, soft-deleting a design
 * leaves orphaned `design_partners_link` rows pointing at a deleted
 * design — which then surface (as null `design`) in
 * `GET /partners/designs` and used to 500 the listing.
 */
const resolveDesignPartnerLinksStep = createStep(
  "resolve-design-partner-links",
  async (input: { design_id: string }, { container }) => {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY);
    const { data } = await query.graph({
      entity: designPartnersLink.entryPoint,
      filters: { design_id: input.design_id },
      fields: ["partner_id"],
    });
    const partnerIds = (data ?? [])
      .map((l: any) => l.partner_id)
      .filter(Boolean) as string[];
    return new StepResponse(partnerIds);
  }
);

type DeleteDesignWorkFlowInput = {
  id: string;
};


/**
 * Dismiss every link this design sits in (#1857).
 *
 * A soft-deleted design is excluded from query results, so every surviving link
 * row expands to a NULL for its readers rather than to a design.
 *
 * `Link.delete` is the CASCADE form: it dismisses link rows across every module
 * that links to this one, so nothing here has to enumerate them — the failure
 * mode of naming links one at a time is that the file then LOOKS handled while
 * the unnamed ones keep leaking. `Link.restore` is the inverse, and runs as the
 * compensation so a restored record does not come back stripped of its links.
 */
const dismissDesignLinksStep = createStep(
  "dismissDesignLinksStep",
  async (input: { id: string }, { container }) => {
    const link: Link = container.resolve(ContainerRegistrationKeys.LINK);
    await link.delete({ [DESIGN_MODULE]: { design_id: input.id } });
    return new StepResponse({ id: input.id }, { id: input.id });
  },
  async (undo: { id: string } | undefined, { container }) => {
    if (!undo?.id) return;
    const link: Link = container.resolve(ContainerRegistrationKeys.LINK);
    await link.restore({ [DESIGN_MODULE]: { design_id: undo.id } }).catch(() => {});
  },
);

export const deleteDesignWorkflow = createWorkflow(
  "delete-design",
  (input: DeleteDesignWorkFlowInput) => {
    // Dismiss the design ↔ partner links first so no orphan rows remain
    // after the soft-delete. `dismissRemoteLinkStep` (core-flows) is the
    // canonical way to remove module links inside a workflow — it also
    // registers the inverse (re-create) as compensation automatically.
    const partnerIds = resolveDesignPartnerLinksStep({ design_id: input.id });

    const linkPairs = transform({ input, partnerIds }, (data) =>
      (data.partnerIds ?? []).map(
        (partnerId: string): LinkDefinition => ({
          [DESIGN_MODULE]: { design_id: data.input.id },
          [PARTNER_MODULE]: { partner_id: partnerId },
        })
      )
    );

    when({ linkPairs }, (data) => (data.linkPairs?.length ?? 0) > 0).then(() => {
      dismissRemoteLinkStep(linkPairs);
    });

    const result = deleteDesignStep(input);

    /*
     * 🔴 The partner link above was dismissed BY NAME, and a design sits in
     * twenty link tables. Naming one is what made this look solved: prod
     * carries designs whose task, inventory and customer links outlived them —
     * 8 rows across three tables — plus one in the very table the step above
     * handles. This sweeps the rest by cascade.
     */
    dismissDesignLinksStep({ id: input.id });

    return new WorkflowResponse(result);
  },
);

export default deleteDesignWorkflow;
