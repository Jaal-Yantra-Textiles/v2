import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { mastra } from "../../../../mastra";

type PageContext = {
  title: string;
  content: string;
  page_type: string;
};

export type GenerateAIMetadataStepInput = {
  pageContext: PageContext;
};


export const generateAIMetadataStep = createStep(
  "generate-ai-metadata-step",
  async (input: GenerateAIMetadataStepInput, {container, context}) => {
    if (process.env.NODE_ENV === "test") {
      const json = JSON.parse("{\n  \"meta_title\": \"Cici Label - Leading Fashion Brand in Textiles\",\n  \"meta_description\": \"Discover Cici Label, the best in the world of textiles. Explore our stylish and sustainable fashion collection.\",\n  \"meta_keywords\": \"Cici Label, Fashion Brand, Textiles, Sustainable Fashion, Best in the World, Home\"\n}")
      return new StepResponse(json);
    }

    // Run the Mastra SEO workflow directly (not via fetch) 
    const { runId, start } = mastra.getWorkflow('seoWorkflow').createRun();
    const workflowResult = await start({ triggerData: input.pageContext });

    // Check if workflow execution was successful
    if (workflowResult.results.validateMetadata?.status === 'failed') {
      const error = workflowResult.results.validateMetadata.error;
      throw new Error(`Metadata validation failed: ${error}`);
    }

    if (workflowResult.results.generateMetadata?.status === 'success') {
      const metadata = workflowResult.results.generateMetadata.output;
      return new StepResponse(metadata);
    }

    throw new Error('Workflow execution failed');
  }
);
