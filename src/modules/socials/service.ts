import Sma from "./models/sma";
import { MedusaService } from "@medusajs/framework/utils";
import Socials from "./models/socials";

class SocialsService extends MedusaService({
  Sma,
  Socials,
}) {
  constructor() {
    super(...arguments)
  }
}

export default SocialsService;
