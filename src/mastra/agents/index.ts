// @ts-nocheck - Ignore all TypeScript errors in this file
import { openai } from "@ai-sdk/openai";
import { Agent } from "@mastra/core/agent";
import { anthropic } from "@ai-sdk/anthropic";
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

export const seoAgent = new Agent({
  name: "seo-agent",
  instructions:
    "You are an expert SEO specialist focused on generating concise, impactful metadata. " +
    "Your role is to create optimized metadata within strict character limits:" +
    "\n- Title tags: Keep under 40 characters while being compelling" +
    "\n- Meta descriptions: Maximum 120 characters, focus on value proposition" +
    "\n- Keywords: Maximum 100 characters total, use most impactful terms" +
    "\n- Open Graph/Twitter: Same length restrictions as meta tags" +
    "\n- Schema markup: Keep it focused and under 500 characters" +
    "\nPrioritize brevity while maintaining impact. Always stay well within character limits " +
    "to ensure validation passes. Quality over quantity - each word must serve a purpose.",
  model: openai("gpt-4o-mini"),
});

export const modelAgent = new Agent({
  name: "model-agent",
  instructions:
    "You are an expert in understanding the structure of a given data model. " +
    "Your role is to create properties and metadata that are relevant to the given domain or data model.",
  model: anthropic("claude-3-5-sonnet-20240620")
});


export const designAgent = new Agent({
  name: "design-agent",
  instructions:'You are a design assitant for the designer',
  model: openai("gpt-4o-mini")
});
// Initialize OpenRouter provider
const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

// Create an agent
export const productDescriptionAgent = new Agent({
  model: openrouter('mistralai/mistral-small-3.2-24b-instruct:free') as any,
  name: 'ProductDescriptionAgent',
  instructions:
    'You are an expert product description writer. Given an image and product information, you will generate a compelling and accurate product description. Focus on highlighting key features and benefits that would appeal to the target audience.',
});

