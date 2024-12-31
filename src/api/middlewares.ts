import {
  defineMiddlewares,
  errorHandler,
  MedusaErrorHandlerFunction,
  validateAndTransformBody,
  
} from "@medusajs/framework/http";
import { personSchema, UpdatePersonSchema } from "./admin/persons/validators";
import {
  personTypeSchema,
} from "./admin/persontype/validators";
import { addressSchema } from "./admin/persons/[id]/addresses/validators";
import { contactSchema } from "./admin/persons/[id]/contacts/validators";
import { tagSchema, deleteTagSchema } from "./admin/persons/[id]/tags/validators";
import * as z from "zod";

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
      middlewares: [validateAndTransformBody(deleteTagSchema)],
    },
    // PersonType routes
    {
      matcher: "/admin/persontype",
      method: "POST",
      middlewares: [validateAndTransformBody(personTypeSchema)],
    },
    {
      matcher: "/admin/persontype/:id",
      method: "POST",
      middlewares: [validateAndTransformBody(personTypeSchema)],
    },
    {
      matcher: "/admin/persontype/:id",
      method: "DELETE",
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

    // For everything else, fall back to the default error handler
    next(error);
  }) as MedusaErrorHandlerFunction,
});
