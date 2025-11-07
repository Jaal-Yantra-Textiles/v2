import Feedback from "./models/feedback";
import { MedusaService } from "@medusajs/framework/utils";
// Import your models here, e.g.:
// import MyModel from "./models/MyModel";

class FeedbackService extends MedusaService({
  Feedback,
  // Register your models here, e.g.:
  // MyModel,
}) {
  constructor() {
    super(...arguments)
  }
}

export default FeedbackService;
