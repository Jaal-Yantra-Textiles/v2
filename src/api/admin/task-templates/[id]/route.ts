import {
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { UpdateTaskTemplate } from "../validators";
import { updateTaskTemplateWorkflow } from "../../../../workflows/task-templates/update-template";
import { deleteTaskTemplateWorkflow } from "../../../../workflows/task-templates/delete-template";
import { TaskTemplateAllowedFields, refetchTaskTemplate } from "../helpers";
import { listSingleTaskTemplateWorkflow } from "../../../../workflows/task-templates/list-single-template";

// GET single task template
export const GET = async (
  req: MedusaRequest & {
    params: { id: string };
    remoteQueryConfig?: {
      fields?: string[] | TaskTemplateAllowedFields[];
    };
  },
  res: MedusaResponse
) => {
  try {
    const { result } = await listSingleTaskTemplateWorkflow(req.scope).run({
      input: {
        id: req.params.id,
        config: {
          relations:[ "category"]
        }
      },
    });
   
    res.status(200).json({ task_template: result });
  } catch (error) {
    res.status(404).json({ error: "Task template not found" });
  }
};

// Update task template
export const PUT = async (
  req: MedusaRequest<UpdateTaskTemplate> & {
    params: { id: string };
    remoteQueryConfig?: {
      fields?: string[] | TaskTemplateAllowedFields[];
    };
  },
  res: MedusaResponse,
) => {
  const { result, errors } = await updateTaskTemplateWorkflow(req.scope).run({
    input: {
      id: req.params.id,
      update: req.validatedBody,
    },
  });

  if (errors.length > 0) {
    console.warn("Error reported at", errors);
    throw errors;
  }

  const template = await refetchTaskTemplate(
    req.params.id,
    req.scope,
    ["*","category.*", "category.name"],
  );


  res.status(200).json({ task_template: template });
};

// Delete task template
export const DELETE = async (
  req: MedusaRequest & {
    params: { id: string };
  },
  res: MedusaResponse,
) => {
  const { errors } = await deleteTaskTemplateWorkflow(req.scope).run({
    input: {
      id: req.params.id,
    },
  });

  if (errors.length > 0) {
    console.warn("Error reported at", errors);
    throw errors;
  }

  res.status(204).send();
};
