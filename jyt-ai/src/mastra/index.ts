
import { createLogger, Mastra } from '@mastra/core';
import { seoWorkflow } from './workflows/seo';
import designValidationWorkflow from './workflows/designValidator'
import { FileTransport } from "@mastra/loggers/file";

export const mastra = new Mastra({
    workflows: {
        seoWorkflow,
        designValidationWorkflow
    },
     logger: createLogger({
        name: "Mastra",
        transports: { file: new FileTransport({ path: "../../logs/joint.log" }) },
        level: "debug",
      })
})
        