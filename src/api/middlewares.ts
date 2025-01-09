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
import { tagSchema, DeleteTagForPerson, deleteTagSchema } from "./admin/persons/[id]/tags/validators";
import * as z from "zod";
import { rawMaterialSchema } from "./admin/inventory-items/[id]/rawmaterials/validators";
import { AdminGetInventoryItemParams } from "@medusajs/medusa/api/admin/inventory-items/validators";

import * as QueryConfig from "../api/admin/inventory-items/[id]/query-config"

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

    // For everything else, fall back to the default error handler
    next(error);
  }) as MedusaErrorHandlerFunction,
});
