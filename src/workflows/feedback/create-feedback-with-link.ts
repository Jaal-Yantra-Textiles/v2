import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { FEEDBACK_MODULE } from "../../modules/feedback";
import FeedbackService from "../../modules/feedback/service";
import { Modules } from "@medusajs/framework/utils";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

export type CreateFeedbackWithLinkInput = {
  rating: "one" | "two" | "three" | "four" | "five";
  comment?: string;
  status?: "pending" | "reviewed" | "resolved";
  submitted_by: string;
  submitted_at?: Date;
  reviewed_by?: string;
  reviewed_at?: Date;
  metadata?: Record<string, any>;
  // Link information
  link_to?: {
    partner_id?: string;
    task_id?: string;
    inventory_order_id?: string;
  };
};

export const createFeedbackStep = createStep(
  "create-feedback-with-link-step",
  async (input: CreateFeedbackWithLinkInput, { container }) => {
    const service: FeedbackService = container.resolve(FEEDBACK_MODULE);
    
    // Set submitted_at if not provided
    const feedbackData = {
      ...input,
      submitted_at: input.submitted_at || new Date(),
    };
    
    // Remove link_to from feedback data
    const { link_to, ...feedbackInput } = feedbackData;
    
    const created = await service.createFeedbacks(feedbackInput);
    return new StepResponse({ feedback: created, link_to }, created.id);
  },
  async (id: string, { container }) => {
    const service: FeedbackService = container.resolve(FEEDBACK_MODULE);
    await service.softDeleteFeedbacks(id);
  }
);

export const linkFeedbackStep = createStep(
  "link-feedback-step",
  async (
    input: { feedback_id: string; link_to?: CreateFeedbackWithLinkInput["link_to"] },
    { container }
  ) => {
    if (!input.link_to) {
      return new StepResponse({ linked: false }, []);
    }

    const remoteLink = container.resolve(Modules.LINK) as any;
    const links: any[] = [];

    // Link to partner if partner_id is provided
    if (input.link_to.partner_id) {
      await remoteLink.create({
        partner_partner: {
          partner_id: input.link_to.partner_id,
        },
        feedback_feedback: {
          feedback_id: input.feedback_id,
        },
      });
      links.push({ type: "partner", id: input.link_to.partner_id });
    }

    // Link to task if task_id is provided
    if (input.link_to.task_id) {
      await remoteLink.create({
        tasks_task: {
          task_id: input.link_to.task_id,
        },
        feedback_feedback: {
          feedback_id: input.feedback_id,
        },
      });
      links.push({ type: "task", id: input.link_to.task_id });
    }

    // Link to inventory order if inventory_order_id is provided
    if (input.link_to.inventory_order_id) {
      await remoteLink.create({
        inventory_orders_inventory_orders: {
          inventory_orders_id: input.link_to.inventory_order_id,
        },
        feedback_feedback: {
          feedback_id: input.feedback_id,
        },
      });
      links.push({ type: "inventory_order", id: input.link_to.inventory_order_id });
    }

    return new StepResponse({ linked: true, links }, links);
  },
  async (links: any[], { container }) => {
    // Rollback: delete the created links
    const remoteLink = container.resolve(Modules.LINK) as any;
    for (const link of links) {
      try {
        if (link.type === "partner") {
          await remoteLink.dismiss({
            partner_partner: {
              partner_id: link.id,
            },
            feedback_feedback: {
              feedback_id: link.feedback_id,
            },
          });
        } else if (link.type === "task") {
          await remoteLink.dismiss({
            tasks_task: {
              task_id: link.id,
            },
            feedback_feedback: {
              feedback_id: link.feedback_id,
            },
          });
        } else if (link.type === "inventory_order") {
          await remoteLink.dismiss({
            inventory_orders_inventory_orders: {
              inventory_orders_id: link.id,
            },
            feedback_feedback: {
              feedback_id: link.feedback_id,
            },
          });
        }
      } catch (error) {
        console.error(`Failed to rollback link: ${link.type}`, error);
      }
    }
  }
);

export const createFeedbackWithLinkWorkflow = createWorkflow(
  "create-feedback-with-link",
  (input: CreateFeedbackWithLinkInput) => {
    const result = createFeedbackStep(input);
    
    const linkResult = linkFeedbackStep({
      feedback_id: result.feedback.id,
      link_to: result.link_to,
    });

    return new WorkflowResponse({
      feedback: result.feedback,
      linkResult,
    });
  }
);
