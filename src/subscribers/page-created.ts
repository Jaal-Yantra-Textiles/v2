import type {
  SubscriberConfig,
  SubscriberArgs,
} from "@medusajs/framework";
import { getAIMetadataForPageWorkflow } from "../workflows/website/website-page/get-ai-metadata-generated-on-page";

export default async function pageCreatedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string , genMetaDataLLM: boolean }>) {
  console.log(data)
  await getAIMetadataForPageWorkflow(container).run({
    input: {
      id: data.id,
      genMetaDataLLM: data.genMetaDataLLM
    },
  });
}

export const config: SubscriberConfig = {
  event: "page.created",
};
