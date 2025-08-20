// @ts-nocheck - Ignore all TypeScript errors in this file
import { Mastra } from "@mastra/core";
import { seoWorkflow } from "./workflows/seo";
import designValidationWorkflow from './workflows/designValidator';
import productDescriptionWorkflow from './workflows/productDescription';
import { imageExtractionWorkflow } from './workflows/imageExtraction';
import { generalChatWorkflow } from "./workflows/generalChat";

export const mastra = new Mastra({
    workflows: {
        seoWorkflow,
        designValidationWorkflow,
        productDescriptionWorkflow,
        imageExtractionWorkflow,
        generalChatWorkflow,
    },
})