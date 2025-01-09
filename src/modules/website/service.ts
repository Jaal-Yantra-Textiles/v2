import { MedusaService } from "@medusajs/framework/utils";
import Website from "./models/website";
import Page from "./models/page";

class WebsiteService extends MedusaService({
  Website,
  Page,
}) {
  constructor() {
    super(...arguments)
  }
}

export default WebsiteService;
