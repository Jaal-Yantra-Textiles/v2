import {
  defineMiddlewares,
  MedusaErrorHandlerFunction,
  validateAndTransformBody,
  validateAndTransformQuery,
} from "@medusajs/framework/http";
import { personSchema, UpdatePersonSchema } from "./admin/persons/validators";
import {
  personTypeSchema,
} from "./admin/persontypes/validators";
import { addressSchema } from "./admin/persons/[id]/addresses/validators";
import { contactSchema } from "./admin/persons/[id]/contacts/validators";
import { tagSchema, deleteTagSchema } from "./admin/persons/[id]/tags/validators";
import * as z from "zod";
import { rawMaterialSchema } from "./admin/inventory-items/[id]/rawmaterials/validators";
import { designSchema, UpdateDesignSchema } from "./admin/designs/validators";
import { taskTemplateSchema, updateTaskTemplateSchema } from "./admin/task-templates/validators";
import { AdminPostDesignTasksReq } from "./admin/designs/[id]/tasks/validators";
import { AdminPutDesignTaskReq } from "./admin/designs/[id]/tasks/[taskId]/validators";
import { 
  websiteSchema, 
  updateWebsiteSchema,
} from "./admin/websites/validators";
import {
  pageSchema,
  createPagesSchema,
  updatePageSchema,
  postPagesSchema,
} from "./admin/websites/[id]/pages/validators";
import {  createBlocksSchema, ReadBlocksQuerySchema, updateBlockSchema } from "./admin/websites/[id]/pages/[pageId]/blocks/validators";
import { AdminPostDesignInventoryReq } from "./admin/designs/[id]/inventory/validators";

export default defineMiddlewares({
  routes: [
    {
      matcher: "/admin/persons",
      method: "POST",
      middlewares: [validateAndTransformBody(personSchema)],
    },
    {
      matcher: "/admin/persons/:id",
      method: "POST",
      middlewares: [validateAndTransformBody(UpdatePersonSchema)],
    },
    {
      matcher: "/admin/persons/:id/addresses",
      method: "POST",
      middlewares: [validateAndTransformBody(addressSchema)],
    },
    {
      matcher: "/admin/persons/:id/addresses/:addressId",
      method: "POST",
      middlewares: [validateAndTransformBody(addressSchema)],
    },
    // Contact routes
    {
      matcher: "/admin/persons/:id/contacts",
      method: "POST",
      middlewares: [validateAndTransformBody(contactSchema)],
    },
    {
      matcher: "/admin/persons/:id/contacts/:contactId",
      method: "POST",
      middlewares: [validateAndTransformBody(contactSchema)],
    },
    // Tag routes
    {
      matcher: "/admin/persons/:id/tags",
      method: "POST",
      middlewares: [validateAndTransformBody(tagSchema)],
    },
    {
      matcher: "/admin/persons/:id/tags",
      method: "PUT",
      middlewares: [validateAndTransformBody(tagSchema)],
    },
    {
      matcher: "/admin/persons/:id/tags",
      method: "DELETE",
      middlewares: [validateAndTransformQuery(deleteTagSchema, {})],
    },
    // PersonType routes
    {
      matcher: "/admin/persontypes",
      method: "POST",
      middlewares: [validateAndTransformBody(personTypeSchema)],
    },
    {
      matcher: "/admin/persontypes/:id",
      method: "POST",
      middlewares: [validateAndTransformBody(personTypeSchema)],
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
      middlewares: [validateAndTransformBody(rawMaterialSchema)],
    },
    {
      matcher: "/admin/designs",
      method: "POST",
      middlewares: [validateAndTransformBody(designSchema)],
    },
    {
      matcher: "/admin/designs/:id",
      method: "PUT",
      middlewares: [validateAndTransformBody(UpdateDesignSchema)],
    },

    {
      matcher: "/admin/designs/:id",
      method: "GET",
      middlewares: [],
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
      middlewares: [validateAndTransformBody(AdminPostDesignInventoryReq)],
    },

    //Task on Designs 

    {
      matcher: "/admin/designs/:id/tasks",
      method: "POST",
      middlewares: [validateAndTransformBody(AdminPostDesignTasksReq)],
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
      middlewares: [validateAndTransformBody(AdminPutDesignTaskReq)],
    },

    // Task-Templates 
    {
      matcher: "/admin/task-templates",
      method: "POST",
      middlewares: [validateAndTransformBody(taskTemplateSchema)],
    },
    {
      matcher: "/admin/task-templates/:id",
      method: "PUT",
      middlewares: [validateAndTransformBody(updateTaskTemplateSchema)],
    },

    // Website routes
    {
      matcher: "/admin/websites",
      method: "POST",
      middlewares: [validateAndTransformBody(websiteSchema)],
    },
    {
      matcher: "/admin/websites/:id",
      method: "PUT",
      middlewares: [validateAndTransformBody(updateWebsiteSchema)],
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
      middlewares: [validateAndTransformBody(postPagesSchema)],
    },
    {
      matcher: "/admin/websites/:id/pages/:pageId",
      method: "PUT",
      middlewares: [validateAndTransformBody(updatePageSchema)],
    },

    {
      matcher: "/admin/websites/:id/pages/:pageId/blocks",
      method: "POST",
      middlewares: [validateAndTransformBody(createBlocksSchema)],
    },

    {
      matcher: "/admin/websites/:id/pages/:pageId/blocks",
      method: "GET",
      middlewares: [validateAndTransformQuery(ReadBlocksQuerySchema, {})],
    },

    {
      matcher: "/admin/websites/:id/pages/:pageId/blocks/:blockId",
      method: "PUT",
      middlewares: [validateAndTransformBody(updateBlockSchema)],
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
      middlewares: [],
    },
    {
      matcher: "/web/website/:domain",
      method: "GET",
      middlewares: [],
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
