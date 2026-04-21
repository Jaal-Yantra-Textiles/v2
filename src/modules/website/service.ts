import { MedusaService } from "@medusajs/framework/utils";
import Website from "./models/website";
import WebsiteDomain from "./models/website-domain";
import Page from "./models/page";
import  Block  from "./models/blocks";
import SubscriptionSendLog from "./models/subscription-send-log";

class WebsiteService extends MedusaService({
  Website,
  WebsiteDomain,
  Page,
  Block,
  SubscriptionSendLog,
}) {
  constructor() {
    super(...arguments)
  }

}

export default WebsiteService;
