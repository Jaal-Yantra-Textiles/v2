import { MedusaService } from "@medusajs/framework/utils";
import Website from "./models/website";
import Page from "./models/page";
import  Block  from "./models/blocks";

class WebsiteService extends MedusaService({
  Website,
  Page,
  Block
}) {
  constructor() {
    super(...arguments)
  }

}

export default WebsiteService;
