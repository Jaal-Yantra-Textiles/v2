import { MedusaService } from "@medusajs/framework/utils"

import DesignInquiry from "./models/design-inquiry"
import DesignInquiryQuestion from "./models/design-inquiry-question"
import DesignInquiryResponse from "./models/design-inquiry-response"
import DesignInquiryAnswer from "./models/design-inquiry-answer"

class DesignInquiryService extends MedusaService({
  DesignInquiry,
  DesignInquiryQuestion,
  DesignInquiryResponse,
  DesignInquiryAnswer,
}) {}

export default DesignInquiryService
