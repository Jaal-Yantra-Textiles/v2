import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  when,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { WEBSITE_MODULE } from "../../../modules/website";
import WebsiteService from "../../../modules/website/service";
import { generateAIMetadataStep } from "./steps/generate-ai-metadata";
import { sendNotificationsStep } from "@medusajs/medusa/core-flows";

export type GetAIMetadataForPageStepInput = {
  id: string;
  genMetaDataLLM: boolean;
};

export type PageMetaData = {

  // page id

  id: string;

  ai_metadata: {
    meta_title: string;
    meta_description: string;
    meta_keywords: string;
    og_title: string;
    og_description: string;
    og_image: string;
    twitter_card: string;
    twitter_title: string;
    twitter_description: string;
    twitter_image: string;
    schema_markup: string;
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
  async (input: PageMetaData, { container }) => {
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE);
    // Update the page with the generated metadata
    const updatedPage = await websiteService.updatePages({
      selector: {
        id: input.id
      },
      data: {
        meta_description: input.ai_metadata.meta_description,
        meta_title: input.ai_metadata.meta_title,
        meta_keywords: input.ai_metadata.meta_keywords,
        metadata: {
          og_title: input.ai_metadata.og_title,
          og_description: input.ai_metadata.og_description,
          og_image: input.ai_metadata.og_image,
          twitter_card: input.ai_metadata.twitter_card,
          twitter_title: input.ai_metadata.twitter_title,
          twitter_description: input.ai_metadata.twitter_description,
          twitter_image: input.ai_metadata.twitter_image,
          schema_markup: input.ai_metadata.schema_markup
        }
      },
    });

    return new StepResponse(updatedPage);
  }
);

export type GetAIMetadataForPageWorkflowInput = GetAIMetadataForPageStepInput;

export const getAIMetadataForPageWorkflow = createWorkflow(
  { 
    name: "get-ai-metadata-for-page",
    store: true,
    storeExecution: true
  },
  
  (input: GetAIMetadataForPageWorkflowInput) => { 
    const page = retrievePageStep(input);
    const isGenNeeded = when(
      input, 
      (input) => {
        return input.genMetaDataLLM
      }
    ).then(() => {
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
        const pageUpdateInfo = transform({updatedPage}, (data) => {
          return [
          {
            to: "",
            channel: "feed",
            template: "admin-ui",
            data: {
              title: "Page metadata created",
              description: `Page metadata created with the help of LLM! Page ID: ${page.id}`
            }
          }
          ]
        });
        sendNotificationsStep(pageUpdateInfo)
      return updatedPage;
    })
    return new WorkflowResponse({isGenNeeded});
  }
);
