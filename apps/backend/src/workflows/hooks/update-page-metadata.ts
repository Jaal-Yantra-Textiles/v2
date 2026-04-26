import { StepResponse } from "@medusajs/framework/workflows-sdk";
import { createPageWorkflow } from "../website/website-page/create-page";



createPageWorkflow.hooks.pageCreated(
    async ({ page_id }, { container }) => {
    // TODO perform an action
    // Check if  no user has supplied the metadata then perform the AI based metadata generation
    return new StepResponse()
  })