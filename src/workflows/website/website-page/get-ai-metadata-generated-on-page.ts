import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { WEBSITE_MODULE } from "../../../modules/website";
import WebsiteService from "../../../modules/website/service";
import { generateAIMetadataStep } from "./steps/generate-ai-metadata";

export type GetAIMetadataForPageStepInput = {
  id: string;
};

export type PageMetaData = {

  // page id

  id: string;

  ai_metadata: {
    meta_title: string;
    meta_description: string;
    meta_keywords: string;
  }
}

export const retrievePageStep = createStep(
  "retrieve-page-step",
  async (input: GetAIMetadataForPageStepInput, { container }) => {
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE);
    
    // Get the page
    const page = await websiteService.retrievePage(input.id);
    if (!page) {
      throw new Error("Page not found");
    }
    return new StepResponse(page);
  }
  
)

export const getAIMetadataForPageStep = createStep(
  "get-ai-metadata-for-page-step",
  async (input: PageMetaData, { container , context}) => {
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE);

    // Update the page with the generated metadata
    const updatedPage = await websiteService.updatePages({
      selector: {
        id: input.id
      },
      data: {
        metadata: {
          ...input.ai_metadata
        }
      },
    });

    return new StepResponse(updatedPage);
  }
);

export type GetAIMetadataForPageWorkflowInput = GetAIMetadataForPageStepInput;

export const getAIMetadataForPageWorkflow = createWorkflow(
  "get-ai-metadata-for-page",
  (input: GetAIMetadataForPageWorkflowInput) => {
    const page = retrievePageStep(input);
    const pageMetadata = generateAIMetadataStep({
      pageContext: {
        title: page.title,
        content: page.content,
        page_type: page.page_type
      }
    });
    const updatedPage = getAIMetadataForPageStep(
      {
        id: page.id, 
        ai_metadata: pageMetadata
      });

    return new WorkflowResponse(updatedPage);
  }
);
