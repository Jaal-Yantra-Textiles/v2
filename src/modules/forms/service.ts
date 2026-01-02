import { MedusaService } from "@medusajs/framework/utils";
import Form from "./models/form"
import FormField from "./models/form-field"
import FormResponse from "./models/form-response"

class FormsService extends MedusaService({
  Form,
  FormField,
  FormResponse,
}) {
  constructor() {
    super(...arguments)
  }
}

export default FormsService;
