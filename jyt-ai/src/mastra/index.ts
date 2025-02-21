
import { createLogger, Mastra } from '@mastra/core';
import { seoWorkflow } from './workflows/seo';

export const mastra = new Mastra({
    workflows: {
        seoWorkflow
    },
     logger: createLogger({ name: "Mastra", level: "debug" })
})
        