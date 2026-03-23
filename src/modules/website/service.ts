import { MedusaService } from "@medusajs/framework/utils";
import Website from "./models/website";
import Page from "./models/page";
import  Block  from "./models/blocks";
import SubscriptionSendLog from "./models/subscription-send-log";

class WebsiteService extends MedusaService({
  Website,
  Page,
  Block,
  SubscriptionSendLog,
}) {
  constructor() {
    super(...arguments)
  }

}

export default WebsiteService;
