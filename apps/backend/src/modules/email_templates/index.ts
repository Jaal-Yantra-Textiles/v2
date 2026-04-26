import { Module } from "@medusajs/framework/utils";
import Email_templatesService from "./service";

export const EMAIL_TEMPLATES_MODULE = "email_templates";

const EmailTemplateModule = Module(EMAIL_TEMPLATES_MODULE, {
  service: Email_templatesService,
});

export default EmailTemplateModule;
