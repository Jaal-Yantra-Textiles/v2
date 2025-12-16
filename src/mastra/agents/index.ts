// @ts-nocheck - Ignore all TypeScript errors in this file
import { openai } from "@ai-sdk/openai";
import { Agent } from "@mastra/core/agent";
import { anthropic } from "@ai-sdk/anthropic";
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { memory } from "../memory";

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
  model: openrouter('amazon/nova-2-lite-v1:free') as any,
  name: 'ProductDescriptionAgent',
  instructions:
    'You are an expert product description writer. Given an image and product information, you will generate a compelling and accurate product description. Focus on highlighting key features and benefits that would appeal to the target audience.',
});


export const visualFlowCodegenAgent = new Agent({
  model: openrouter("mistralai/devstral-2512:free"),
  name: "visual-flow-codegen-agent",
  instructions:
    "You generate JavaScript code snippets for a Visual Flow execute_code node. " +
    "You must return ONLY valid JSON with keys: code, packages, outputKeys, notes. " +
    "The code should be safe, deterministic, and use only the sandbox globals ($last, $input, $trigger, $context, _, dayjs, uuid, validator, crypto, fetch). " +
    "Prefer using $last for previous node output and $input for multi-node access. " +
    "Avoid network calls unless explicitly requested. " +
    "Never include markdown or explanation outside JSON.",
  memory,
})



// Agent specialized for extracting structured item lists from images (receipts, labels, manifests)
export const imageExtractionAgent = new Agent({
  name: "image-extraction-agent",
  model: openrouter("qwen/qwen2.5-vl-72b-instruct:free"),
  instructions:
    "You are an expert vision analyst that converts images of inventory lists, bills of materials, and packaging labels into clean, structured JSON. " +
    "Return only data that is visible or clearly implied. Use conservative estimates if uncertain and mark items with confidence scores. " +
    "Normalize units (e.g., pcs, m, kg) and include quantity as a number.",
  memory,
})

// General chat agent for conversational tasks (text-only)
export const generalChatAgent = new Agent({
  name: "general-chat-agent",
  model: openrouter("nex-agi/deepseek-v3.1-nex-n1:free"),
  instructions:
    "You are a concise, helpful assistant for a textile commerce platform. " +
    "Answer briefly and propose actions when appropriate.",
  memory,
})

// Note: When calling .generate/.stream, pass threadId/resourceId in context to leverage working memory
