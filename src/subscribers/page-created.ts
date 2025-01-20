import type {
  SubscriberConfig,
  SubscriberArgs,
} from "@medusajs/framework";
import { getAIMetadataForPageWorkflow } from "../workflows/website/website-page/get-ai-metadata-generated-on-page";

export default async function pageCreatedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {

  await getAIMetadataForPageWorkflow(container).run({
    input: data,
  });
}

export const config: SubscriberConfig = {
  event: "page.created",
};
