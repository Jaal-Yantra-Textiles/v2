import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { listTaskTemplatesCategoriesWorkflow } from "../../../../workflows/task-templates/list-template-categories";

type TaskTemplateCategoriesAllowedFields =
    | "name"
    | "description"
    | "metadata";

export const GET = async (
    req: MedusaRequest & {
      query: {
        offset?: number;
        limit?: number;
        name?: string;
        description?: string;
        fields?: string[];
        expand?: string[];
      };
      remoteQueryConfig?: {
        fields?: TaskTemplateCategoriesAllowedFields[];
      };
    },
    res: MedusaResponse
  ) => {
    try {
      const { result, errors } = await listTaskTemplatesCategoriesWorkflow(req.scope).run({
        input: {
          filters: {
            name: req.query.name,
            description: req.query.description,
          },
          config: {
            skip: Number(req.query.offset) || 0,
            take: Number(req.query.limit) || 10,
            select: req.query.fields,
          }
        },
      });
  
      if (errors.length > 0) {
        console.warn("Error reported at", errors);
        throw errors;
      }
  
      const { categories, count } = result;
  
      res.status(200).json({
        categories,
        count,
        offset: req.query.offset || 0,
        limit: req.query.limit || 10,
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  };
  