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
    return new WorkflowResponse(result);
  },
);

export default deleteDesignWorkflow;
