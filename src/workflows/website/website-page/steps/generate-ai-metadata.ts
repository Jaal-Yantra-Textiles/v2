import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { Mistral } from '@mistralai/mistralai';

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
    const client = new Mistral({ apiKey: process.env.MISTRA_API_KEY });
  
    if (process.env.NODE_ENV === "test") {
      const json = JSON.parse("{\n  \"meta_title\": \"Cici Label - Leading Fashion Brand in Textiles\",\n  \"meta_description\": \"Discover Cici Label, the best in the world of textiles. Explore our stylish and sustainable fashion collection.\",\n  \"meta_keywords\": \"Cici Label, Fashion Brand, Textiles, Sustainable Fashion, Best in the World, Home\"\n}")
    
      return new StepResponse(json);
    }

    try {
      const chatResponse = await client.agents.complete({
        agentId: process.env.AGENT_ID as string,
        messages: [
          {
            role: "user",
            content: `Generate the metadata for the page and return the output in key values json. The metadata for the page is oriented towards textiles and should be SEO Friendly. Here is the page context: ${JSON.stringify(input.pageContext)}`,
          },
        ],
      });

      const metadata = JSON.parse(chatResponse.choices[0].message.content)
      return new StepResponse(metadata);
    } catch (error) {
      console.error("Error generating AI metadata:", error);
      throw error;
    }
  }
);
