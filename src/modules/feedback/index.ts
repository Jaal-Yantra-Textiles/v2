import { Module } from "@medusajs/framework/utils";
import FeedbackService from "./service";

export const FEEDBACK_MODULE = "feedback";

const FeedbackModule = Module(FEEDBACK_MODULE, {
  service: FeedbackService,
});

export default FeedbackModule;
