import SocialPost from "./models/SocialPost";
import SocialPlatform from "./models/SocialPlatform";
import Sma from "./models/sma";
import { MedusaService } from "@medusajs/framework/utils";


class SocialsService extends MedusaService({
  SocialPost,
  SocialPlatform,
  Sma,
}) {
  constructor() {
    super(...arguments)
  }
}

export default SocialsService;
