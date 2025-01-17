import {
    createStep,
    createWorkflow,
    StepResponse,
    WorkflowResponse,
  } from "@medusajs/framework/workflows-sdk";
  import { WEBSITE_MODULE } from "../../../modules/website";
  import WebsiteService from "../../../modules/website/service";
  
  export type ListPageStepInput = {
    website_id?: string;
    page_id: string;
  };
  
  export const listPageStep = createStep(
    "list-single-page-step",
    async (input: ListPageStepInput, { container }) => {
      const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE);
      
      // If website_id is provided, verify the website exists
      if (input.website_id) {
        await websiteService.retrieveWebsite(input.website_id);
      }
      
      // List Page entities
      const page = await websiteService.retrievePage(input.page_id);
  
      return new StepResponse(page);
    }
  );
  
  export type ListPageWorkflowInput = ListPageStepInput;
  
  export const listPageWorkflow = createWorkflow(
    "list-single-page",
    (input: ListPageWorkflowInput) => {
      const page = listPageStep(input);
      return new WorkflowResponse(page);
    },
  );
  