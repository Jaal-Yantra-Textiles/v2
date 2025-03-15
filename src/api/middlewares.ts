import {
  defineMiddlewares,
  MedusaErrorHandlerFunction,
  validateAndTransformBody,
  validateAndTransformQuery,
  authenticate,
  MedusaRequest,
  MedusaResponse,
  MedusaNextFunction,
} from "@medusajs/framework/http";
import { ConfigModule } from "@medusajs/framework/types";
import { parseCorsOrigins } from "@medusajs/framework/utils";
import cors from "cors";
import { personSchema, ReadPersonQuerySchema, UpdatePersonSchema } from "./admin/persons/validators";

// Helper function to wrap Zod schemas for compatibility with validateAndTransformBody
const wrapSchema = <T extends z.ZodType>(schema: T) => {
  return z.preprocess((obj) => obj, schema) as any;
};

import {
  personTypeSchema,
} from "./admin/persontypes/validators";
import { addressSchema } from "./admin/persons/[id]/addresses/validators";
import { contactSchema } from "./admin/persons/[id]/contacts/validators";
import { tagSchema, deleteTagSchema } from "./admin/persons/[id]/tags/validators";
import * as z from "zod";
import { rawMaterialSchema, UpdateRawMaterialSchema } from "./admin/inventory-items/[id]/rawmaterials/validators";
import { CreateMaterialTypeSchema, ReadRawMaterialCategoriesSchema } from "./admin/categories/rawmaterials/validators";
import { designSchema, ReadDesignsQuerySchema, UpdateDesignSchema } from "./admin/designs/validators";
import { taskTemplateSchema, updateTaskTemplateSchema } from "./admin/task-templates/validators";
import { AdminPostDesignTasksReq } from "./admin/designs/[id]/tasks/validators";
import { AdminPutDesignTaskReq } from "./admin/designs/[id]/tasks/[taskId]/validators";
import { 
  websiteSchema, 
  updateWebsiteSchema,
} from "./admin/websites/validators";
import {
  updatePageSchema,
  postPagesSchema,
} from "./admin/websites/[id]/pages/validators";
import {  createBlocksSchema, ReadBlocksQuerySchema, updateBlockSchema } from "./admin/websites/[id]/pages/[pageId]/blocks/validators";
import { AdminPostDesignInventoryReq } from "./admin/designs/[id]/inventory/validators";
import { partnerSchema } from "./partners/validators";
import { partnerPeopleSchema } from "./partners/[id]/validators";
import { AdminPostDesignTaskAssignReq } from "./admin/designs/[id]/tasks/[taskId]/assign/validators";
import { MedusaError } from "@medusajs/framework/utils";

// Utility function to create CORS middleware with configurable options
const createCorsMiddleware = (corsOptions?: cors.CorsOptions) => {
  return (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) => {

    const configModule: ConfigModule = req.scope.resolve("configModule");
    
    // Merge provided options with default CORS settings
    const defaultOptions = {
      origin: parseCorsOrigins(process.env.WEB_CORS as string),
      credentials: true,
    };

   

    const options = { ...defaultOptions, ...corsOptions };
    return cors(options)(req, res, next);
  };
};

export default defineMiddlewares({
  routes: [
    // CORS middleware for public web routes
    {
      matcher: "/web/*",
      middlewares: [createCorsMiddleware()],
    },
    {
      matcher: "/partners",
      method: "POST",
      middlewares: [
        authenticate("partner", ["session", "bearer"], {
          allowUnregistered: true,
        }),
        validateAndTransformBody(wrapSchema(partnerSchema)),
      ],
    },
    {
      matcher: "/partners/details",
      method: "GET",
      middlewares: [
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    
    {
      matcher: "/partners/:id",
      method: "POST",
      middlewares: [
        authenticate("partner", ["session", "bearer"]),
        validateAndTransformBody(wrapSchema(partnerPeopleSchema)),
      ],
    },
    {
      matcher: "/partners/:id",
      method: "GET",
      middlewares: [
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/tasks/:taskId/accept",
      method: "POST",
      middlewares: [
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/admin/persons",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(personSchema))],
    },
    {
      matcher: "/admin/persons",
      method: "GET",
      middlewares: [],
    },
    {
      matcher: "/admin/persons/:id",
      method: "GET",
      middlewares: [validateAndTransformQuery(wrapSchema(ReadPersonQuerySchema), {})],
    },
    {
      matcher: "/admin/persons/:id",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(UpdatePersonSchema))],
    },
    {
      matcher: "/admin/persons/:id/addresses",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(addressSchema))],
    },
    {
      matcher: "/admin/persons/:id/addresses/:addressId",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(addressSchema))],
    },
    // Contact routes
    {
      matcher: "/admin/persons/:id/contacts",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(contactSchema))],
    },
    {
      matcher: "/admin/persons/:id/contacts/:contactId",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(contactSchema))],
    },
    // Tag routes
    {
      matcher: "/admin/persons/:id/tags",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(tagSchema))],
    },
    {
      matcher: "/admin/persons/:id/tags",
      method: "PUT",
      middlewares: [validateAndTransformBody(wrapSchema(tagSchema))],
    },
    {
      matcher: "/admin/persons/:id/tags",
      method: "DELETE",
      middlewares: [validateAndTransformQuery(wrapSchema(deleteTagSchema), {})],
    },
    // PersonType routes
    {
      matcher: "/admin/persontypes",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(personTypeSchema))],
    },
    {
      matcher: "/admin/persontypes/:id",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(personTypeSchema))],
    },
    {
      matcher: "/admin/persontypes/:id",
      method: "DELETE",
      middlewares: [],
    },
    // Inventory Associations

    {
      matcher: "/admin/inventory-items/:id/rawmaterials",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(rawMaterialSchema))],
    },
    {
      matcher: "/admin/inventory-items/:id/rawmaterials/:rawMaterialId",
      method: "PUT",
      middlewares: [validateAndTransformBody(wrapSchema(UpdateRawMaterialSchema))],
    },
    {
      matcher: "/admin/designs",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(designSchema))],
    },
    {
      matcher: "/admin/designs/:id",
      method: "PUT",
      middlewares: [validateAndTransformBody(wrapSchema(UpdateDesignSchema))],
    },

    {
      matcher: "/admin/designs/:id",
      method: "GET",
      middlewares: [validateAndTransformQuery(wrapSchema(ReadDesignsQuerySchema), {})],
    },

    {
      matcher: "/admin/designs/:id",
      method: "DELETE",
      middlewares: [],
    },

    // Inventory linkin on designs 

    {
      matcher: "/admin/designs/:id/inventory",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(AdminPostDesignInventoryReq))],
    },

    //Task on Designs 

    {
      matcher: "/admin/designs/:id/tasks",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(AdminPostDesignTasksReq))],
    },
    // Must add queryParams stuff here
    {
      matcher: "/admin/designs/:id/tasks/:taskId",
      method: "GET",
      middlewares: [],
    },

    {
      matcher: "/admin/designs/:id/tasks/:taskId",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(AdminPutDesignTaskReq))],
    },

    {
      matcher: "/admin/designs/:id/tasks/:taskId/assign",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(AdminPostDesignTaskAssignReq))],
    },

    // Task-Templates 
    {
      matcher: "/admin/task-templates",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(taskTemplateSchema))],
    },
    {
      matcher: "/admin/task-templates/:id",
      method: "PUT",
      middlewares: [validateAndTransformBody(wrapSchema(updateTaskTemplateSchema))],
    },

    // Website routes
    {
      matcher: "/admin/websites",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(websiteSchema))],
    },
    {
      matcher: "/admin/websites/:id",
      method: "PUT",
      middlewares: [validateAndTransformBody(wrapSchema(updateWebsiteSchema))],
    },
    {
      matcher: "/admin/websites/:id",
      method: "DELETE",
      middlewares: [],
    },
    // Website Pages routes
    {
      matcher: "/admin/websites/:id/pages",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(postPagesSchema))],
    },
    {
      matcher: "/admin/websites/:id/pages/:pageId",
      method: "PUT",
      middlewares: [validateAndTransformBody(wrapSchema(updatePageSchema))],
    },

    {
      matcher: "/admin/websites/:id/pages/:pageId/blocks",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(createBlocksSchema))],
    },

    {
      matcher: "/admin/websites/:id/pages/:pageId/blocks",
      method: "GET",
      middlewares: [validateAndTransformQuery(wrapSchema(ReadBlocksQuerySchema), {})],
    },

    {
      matcher: "/admin/websites/:id/pages/:pageId/blocks/:blockId",
      method: "PUT",
      middlewares: [validateAndTransformBody(wrapSchema(updateBlockSchema))],
    },

    {
      matcher: "/admin/websites/:id/pages/:pageId/blocks/:blockId",
      method: "DELETE",
      middlewares: [],
    },

    {
      matcher: "/admin/websites/:id/pages/:pageId",
      method: "DELETE",
      middlewares: [], 
    },
    {
      matcher: "/web/health",
      method: "GET",
      middlewares: [createCorsMiddleware()],
    },
    {
      matcher: "/web/website/:domain",
      method: "GET",
      middlewares: [],
    },

    // Raw Materials Categories API
    {
      matcher: "/admin/categories/rawmaterials",
      method: "GET",
      middlewares: [validateAndTransformQuery(wrapSchema(ReadRawMaterialCategoriesSchema), {})],
    },
    {
      matcher: "/admin/categories/rawmaterials",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(CreateMaterialTypeSchema))],
    },

  ],
  errorHandler: ((
    error: any, // or whatever type you prefer
    req,
    res,
    next
  ) => {
    // Option 1: standard name check
    // if (error.name === "ZodError") {
    // Option 2: check if error is an instance of ZodError
    console.log(error)
    if (error.__isMedusaError){
      if (error.type == 'not_found'){
        return res.status(404).json({
          message: error.message,
        });
      } else {
        return res.status(400).json({
          message: error.message,
        });
      }
    }
    if (error instanceof MedusaError) {
      
      if (error.type == 'not_found'){
        return res.status(404).json({
          error: "ValidatorError",
          issues: error.message,
        });
      }
      return res.status(400).json({
        error: "ValidatorError",
        issues: error.message,
      });
    }
    if (error instanceof z.ZodError) {
      
      /*
       * ZodError has an `issues` array. But in some scenarios, it might be missing or
       * shaped unexpectedly. We’ll guard against that possibility.
       */
      const rawIssues = Array.isArray(error.issues) ? error.issues : [];
      const formattedIssues = rawIssues.map((issue) => ({
        path: Array.isArray(issue?.path)
          ? issue.path.join(".")
          : "unknown_path",
        message: issue?.message ?? "Validation error",
        code: issue?.code ?? "unknown_code",
      }));

      return res.status(400).json({
        error: "ZodError",
        issues: formattedIssues,
      });
    }

    // Handle custom errors
    if (error.type === "not_found") {
      return res.status(404).json({
        message: error.message,
      });
    }

    if (error.type === "duplicate_error") {
      return res.status(400).json({
        message: error.message,
      })
    }

    // For everything else, fall back to the default error handler
    next(error);
  }) as MedusaErrorHandlerFunction,
});
