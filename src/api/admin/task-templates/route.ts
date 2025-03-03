import {
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";

import { TaskTemplate } from "./validators";
import { createTaskTemplateWorkflow } from "../../../workflows/task-templates/create-template";
import { listTaskTemplatesWorkflow } from "../../../workflows/task-templates/list-templates";
import { TaskTemplateAllowedFields, refetchTaskTemplate } from "./helpers";

// Create new task template
export const POST = async (
  req: MedusaRequest<TaskTemplate> & {
    remoteQueryConfig?: {
      fields?: string[] | TaskTemplateAllowedFields[];
    };
  },
  res: MedusaResponse,
) => {

  const { result, errors } = await createTaskTemplateWorkflow(req.scope).run({
    input: req.validatedBody,
  });

  if (errors.length > 0) {
    console.warn("Error reported at", errors);
    throw errors;
  }

  const template = await refetchTaskTemplate(
    result.id,
    req.scope,
    ["*","category.*"],
  );

  res.status(201).json({ task_template: template });
};

// List all task templates
export const GET = async (
  req: MedusaRequest & {
    query: {
      offset?: number;
      limit?: number;
      name?: string;
      priority?: "low" | "medium" | "high";
      category_id?: string;
      fields?: string[];
      expand?: string[];
    };
    remoteQueryConfig?: {
      fields?: string[] | TaskTemplateAllowedFields[];
    };
  },
  res: MedusaResponse
) => {
  try {
    const { result, errors } = await listTaskTemplatesWorkflow(req.scope).run({
      input: {
        filters: {
          name: req.query.name,
          priority: req.query.priority,
          category_id: req.query.category_id,
        },
        config: {
          skip: Number(req.query.offset) || 0,
          take: Number(req.query.limit) || 10,
          select: req.query.fields,
          relations: req.query.expand,
        }
      },
    });

    if (errors.length > 0) {
      console.warn("Error reported at", errors);
      throw errors;
    }

    const { templates, count } = result;

    res.status(200).json({
      task_templates: templates,
      count,
      offset: req.query.offset || 0,
      limit: req.query.limit || 10,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
