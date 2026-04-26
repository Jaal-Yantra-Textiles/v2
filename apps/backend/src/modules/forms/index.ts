import { Module } from "@medusajs/framework/utils";
import FormsService from "./service";

export const FORMS_MODULE = "forms";

const FormsModule = Module(FORMS_MODULE, {
  service: FormsService,
});

export default FormsModule;
