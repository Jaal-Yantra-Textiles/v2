import { Modules } from "@medusajs/framework/utils";
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";

import { INotificationModuleService } from "@medusajs/types";

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
    const notificationModuleService: INotificationModuleService = 
      container.resolve(Modules.NOTIFICATION);

    try {
      const response = await fetch('http://localhost:4111/api/workflows/seoWorkflow/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          triggerData: input.pageContext
        })
      });

      if (!response.ok) {
        throw new Error(`Workflow request failed: ${response.statusText}`);
      }

      const workflowResult = await response.json();
      
      // Check if workflow execution was successful
      if (workflowResult.results.validateMetadata?.status === 'failed') {
        const error = workflowResult.results.validateMetadata.error;
        await notificationModuleService.createNotifications({
          to: "saranshis@pm.me",
          channel: "email",
          template: "metadata-validation-failed",
          data: {
            page: input.pageContext,
            error,
            metadata: workflowResult.results.generateMetadata?.output
          },
        });
        throw new Error(`Metadata validation failed: ${error}`);
      }

      if (workflowResult.results.generateMetadata?.status === 'success') {
        const metadata = workflowResult.results.generateMetadata.output;
        await notificationModuleService.createNotifications({
          to: "saranshis@pm.me",
          channel: "email",
          template: "metadata-created",
          data: {
            page: input.pageContext,
            metadata
          },
        });
        return new StepResponse(metadata);
      }

      throw new Error('Workflow execution failed');
    } catch (error) {
      console.error("Error generating AI metadata:", error);
      await notificationModuleService.createNotifications({
        to: "saranshis@pm.me",
        channel: "email",
        template: "metadata-error",
        data: {
          page: input.pageContext,
          error: error.message
        },
      });
      throw error;
    }
  }
);
