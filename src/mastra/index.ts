// @ts-nocheck - Ignore all TypeScript errors in this file
import { Mastra } from "@mastra/core/mastra";
import { PostgresStore } from "@mastra/pg";
import { seoWorkflow } from "./workflows/seo";
import designValidationWorkflow from './workflows/designValidator';
import productDescriptionWorkflow from './workflows/productDescription';
import { imageExtractionWorkflow } from './workflows/imageExtraction';
import { generalChatWorkflow } from "./workflows/generalChat";
import { visualFlowCodegenWorkflow } from "./workflows/visualFlowCodegen";
import { multiStepApiRequestWorkflow } from "./workflows/multiStepApiRequest";
import { aiV2Workflow } from "./workflows/aiV2";
import { imageGenerationWorkflow } from "./workflows/imagegen";
import { sharedStorage } from "./memory";
import {
    seoAgent,
    designAgent,
    modelAgent,
    productDescriptionAgent,
    visualFlowCodegenAgent,
    imageExtractionAgent,
    generalChatAgent,
} from "./agents";

const mastraConnectionString = process.env.MASTRA_DATABASE_URL || process.env.DATABASE_URL

export const mastra = new Mastra({
    agents: {
        "seo-agent": seoAgent,
        "design-agent": designAgent,
        "model-agent": modelAgent,
        "ProductDescriptionAgent": productDescriptionAgent,
        "visual-flow-codegen-agent": visualFlowCodegenAgent,
        "image-extraction-agent": imageExtractionAgent,
        "general-chat-agent": generalChatAgent,
    },
    workflows: {
        seoWorkflow,
        designValidationWorkflow,
        productDescriptionWorkflow,
        imageExtractionWorkflow,
        generalChatWorkflow,
        aiV2Workflow,
        visualFlowCodegenWorkflow,
        multiStepApiRequestWorkflow,
        imageGenerationWorkflow,
    },
    ...(sharedStorage
        ? { storage: sharedStorage }
        : (mastraConnectionString
            ? { storage: new PostgresStore({ connectionString: mastraConnectionString }) }
            : {})),
    observability: {
        default: {
            enabled: true,
        },
    },
})

export const mastraStorageInit: Promise<boolean> = (async () => {
    try {
        const storage = mastra.getStorage?.()
        return Boolean(storage)
    } catch {
        return false
    }
})()