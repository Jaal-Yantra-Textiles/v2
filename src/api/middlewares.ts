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
import multer from "multer";
import os from "os";
import path from "path";
import { ConfigModule } from "@medusajs/framework/types";
import { parseCorsOrigins } from "@medusajs/framework/utils";
import cors from "cors";
import { z } from "zod";
import { personSchema, listPersonsQuerySchema, UpdatePersonSchema, ReadPersonQuerySchema } from "./admin/persons/validators";
import { getPersonResourceDefinition } from "./admin/persons/resources/registry";

// Helper function to wrap Zod schemas for compatibility with validateAndTransformBody
const wrapSchema = <T extends z.ZodType>(schema: T) => {
  return z.preprocess((obj) => obj, schema) as any;
};

const buildPersonResourceValidator =
  (type: "create" | "update") =>
    (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) => {
      const resourceKey = req.params?.resource;

      if (!resourceKey) {
        return next();
      }

      const definition = getPersonResourceDefinition(resourceKey);

      if (!definition) {
        return next();
      }

      const schema = definition.validators?.[type];

      if (!schema) {
        return next();
      }

      return validateAndTransformBody(wrapSchema(schema))(req, res, next);
    };

const validatePersonResourceCreate = buildPersonResourceValidator("create");
const validatePersonResourceUpdate = buildPersonResourceValidator("update");

import { personTypeSchema, updatePersonTypeSchema } from "./admin/persontypes/validators";
import { addressSchema } from "./admin/persons/[id]/addresses/validators";
import { contactSchema } from "./admin/persons/[id]/contacts/validators";
import { tagSchema, deleteTagSchema } from "./admin/persons/[id]/tags/validators";
import { rawMaterialSchema, UpdateRawMaterialSchema } from "./admin/inventory-items/[id]/rawmaterials/validators";
import { CreateMaterialTypeSchema, ReadRawMaterialCategoriesSchema } from "./admin/categories/rawmaterials/validators";
import { CreateDesignLLMSchema, designSchema, LinkDesignPartnerSchema, ReadDesignsQuerySchema, UpdateDesignSchema } from "./admin/designs/validators";
import { taskTemplateSchema, updateTaskTemplateSchema } from "./admin/task-templates/validators";
import { AdminPostDesignTasksReq } from "./admin/designs/[id]/tasks/validators";
import { AdminPutDesignTaskReq } from "./admin/designs/[id]/tasks/[taskId]/validators";
import {
  AdminApproveProductionRunReq,
  AdminCreateProductionRunReq,
  AdminResumeDispatchProductionRunReq,
  AdminSendProductionRunToProductionReq,
  AdminStartDispatchProductionRunReq,
} from "./admin/production-runs/validators";
import { AdminUpdateProductionRunPolicySchema } from "./admin/production-run-policy/validators";
import {
  websiteSchema,
  updateWebsiteSchema,
} from "./admin/websites/validators";
import {
  updatePageSchema,
  postPagesSchema,
} from "./admin/websites/[id]/pages/validators";
import { createBlocksSchema, ReadBlocksQuerySchema, updateBlockSchema } from "./admin/websites/[id]/pages/[pageId]/blocks/validators";
import { AdminPostDesignInventoryReq, AdminDeleteDesignInventoryReq } from "./admin/designs/[id]/inventory/validators";
import { partnerSchema } from "./partners/validators";
import { partnerPeopleSchema } from "./partners/[id]/validators";
import { AdminGetPartnersParamsSchema } from "./admin/persons/partner/validators";
import { createInventoryOrdersSchema, listInventoryOrdersQuerySchema, ReadSingleInventoryOrderQuerySchema, updateInventoryOrdersSchema, updateInventoryOrderLinesSchema } from "./admin/inventory-orders/validators";
// Import already defined above
import { SendBlogSubscriptionSchema } from "./admin/websites/[id]/pages/[pageId]/subs/route";
import { subscriptionSchema } from "./web/website/[domain]/validators";
import { AdminPostInventoryOrderTasksReq } from "./admin/inventory-orders/[id]/tasks/validators";
import { createStoreSchema } from "./admin/stores/validators";
import { UpdateInventoryOrderTask } from "./admin/inventory-orders/[id]/tasks/[taskId]/validators";
import { TestBlogEmailSchema } from "./admin/websites/[id]/pages/[pageId]/subs/test/route";
import { listSocialPlatformsQuerySchema, SocialPlatformSchema, UpdateSocialPlatformSchema } from "./admin/social-platforms/validators";
import { StoreGenerateAiImageReqSchema } from "./store/ai/imagegen/validators";
import { listSocialPostsQuerySchema, SocialPostSchema, UpdateSocialPostSchema } from "./admin/social-posts/validators";
import { ConfirmBody } from "./admin/persons/geocode-addresses/[transaction_id]/confirm/validators";
import { listPublicPersonsQuerySchema } from "./web/persons/validators";
import { LinkDesignValidator, UnlinkDesignValidator } from "./admin/products/[id]/linkDesign/validators";
import { sendToPartnerSchema } from "./admin/inventory-orders/[id]/send-to-partner/validators";
import { EmailTemplateQueryParams, EmailTemplateSchema, UpdateEmailTemplateSchema } from "./admin/email-templates/validators";
import { CreateAgreementSchema, UpdateAgreementSchema } from "./admin/agreements/validators";
import { AdminImageExtractionReq } from "./admin/ai/image-extraction/validators";
import { AdminSendPersonAgreementReq } from "./admin/persons/[id]/agreements/validators";
import { folderSchema, uploadMediaSchema } from "./admin/medias/validator";
import { ExtractFeaturesRequestSchema } from "./admin/medias/extract-features/validators";
import {
  AdminCreateFormSchema,
  AdminListFormResponsesQuerySchema,
  AdminListFormsQuerySchema,
  AdminSetFormFieldsSchema,
  AdminUpdateFormSchema,
} from "./admin/forms/validators";
// Payments: schemas
import { PaymentSchema, ListPaymentsQuerySchema, UpdatePaymentSchema } from "./admin/payments/validators";
import { CreatePaymentAndLinkSchema } from "./admin/payments/link/validators";
import { ListPaymentsByPersonQuerySchema } from "./admin/payments/persons/[id]/validators";
import { ListPaymentsByPartnerQuerySchema } from "./admin/payments/partners/[id]/validators";
import { ListPaymentMethodsByPersonQuerySchema, CreatePaymentMethodForPersonSchema } from "./admin/payments/persons/[id]/methods/validators";
import { ListPaymentMethodsByPartnerQuerySchema, CreatePaymentMethodForPartnerSchema } from "./admin/payments/partners/[id]/methods/validators";
import { AdminRagSearchQuery } from "./admin/ai/rag/search/validators";
import { AdminAiChatResolveReq, AdminAiChatResolveQuery } from "./admin/ai/chat/resolve/validators";
import { AdminAiChatReq } from "./admin/ai/chat/chat/validators";
import { AdminPostDesignTaskAssignReq } from "./admin/designs/[id]/tasks/[taskId]/assign/validators";
import { AdminPostPartnerTaskAssignReq } from "./admin/partners/[id]/tasks/[taskId]/assign/validators";
import { AdminCreatePartnerTaskReq } from "./admin/partners/[id]/tasks/validators";
import {
  ListPaymentsByPartnerQuerySchema as PartnerListPaymentsByPartnerQuerySchema,
  ListPaymentMethodsByPartnerQuerySchema as PartnerListPaymentMethodsByPartnerQuerySchema,
  CreatePaymentMethodForPartnerSchema as PartnerCreatePaymentMethodForPartnerSchema,
} from "./partners/[id]/payments/validators";
import { sendDesignToPartnerSchema } from "./admin/designs/[id]/send-to-partner/validators";
import { AdminCreateDesignProductionRunSchema } from "./admin/designs/[id]/production-runs/validators";
import { listDesignsQuerySchema } from "./partners/designs/validators";
import { listProductionRunsQuerySchema } from "./partners/production-runs/validators";
import { PartnerDesignInventorySchema } from "./partners/designs/[designId]/inventory/validators";
import { listPartnersQuerySchema, PostPartnerSchema } from "./admin/partners/validators";
import { ListIdentitiesQuerySchema } from "./admin/users/identities/validators";
import { ListInventoryItemRawMaterialsQuerySchema } from "./admin/inventory-items/raw-materials/validators";
import { PartnerCreateStoreReq } from "./partners/stores/validators";
import { PartnerCreateProductReq } from "./partners/products/validators";
import { LinkPersonValidator, UnlinkPersonValidator } from "./admin/products/[id]/linkPerson/validators";
import { GenerateDescriptionValidator } from "./admin/products/[id]/generateDescription/validators";
import { PublishSocialPostSchema } from "./admin/social-posts/[id]/publish/validators";
import { GetAccountsSchema } from "./admin/socials/accounts/validators";
import { FeedbackSchema, UpdateFeedbackSchema } from "./admin/feedbacks/validators";
import { AnalyticsEventQuerySchema } from "./admin/analytics-events/validators";
import { AdminNotificationsQueryParams } from "./admin/notifications/validators";
import {
  CreatePublishingCampaignSchema,
  UpdatePublishingCampaignSchema,
  ListPublishingCampaignsQuerySchema,
  RetryItemSchema,
} from "./admin/publishing-campaigns/validators";
import {
  ListLeadsQuerySchema,
  UpdateLeadSchema,
  SyncLeadsSchema,
  SyncAdAccountsSchema,
  ListCampaignsQuerySchema,
  SyncCampaignsSchema,
  SyncInsightsSchema,
  MetaAdsOverviewQuerySchema,
  CreateRemoteAdSchema,
} from "./admin/meta-ads/validators";
import { webSubmitFormResponseSchema } from "./web/website/[domain]/forms/[handle]/validators";

// Utility function to create CORS middleware with configurable options
const createCorsMiddleware = (corsOptions?: cors.CorsOptions) => {
  return (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) => {
    req.scope.resolve<ConfigModule>("configModule")

    const defaultOptions = {
      origin: parseCorsOrigins(process.env.WEB_CORS as string),
      credentials: true,
    }

    const options = { ...defaultOptions, ...corsOptions }
    return cors(options)(req, res, next)
  }
}

const createCorsPartnerMiddleware = (corsOptions?: cors.CorsOptions) => {
  return (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) => {
    req.scope.resolve<ConfigModule>("configModule")

    const partnerOrigins =
      process.env.PARTNER_CORS ||
      process.env.AUTH_CORS ||
      process.env.ADMIN_CORS ||
      process.env.WEB_CORS ||
      ""

    const defaultOptions = {
      origin: parseCorsOrigins(partnerOrigins),
      credentials: true,
    }
    const options = { ...defaultOptions, ...corsOptions }
    return cors(options)(req, res, next)
  }
}

// Configure multer for small/CSV uploads (memory) - safe small limit
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })

// Configure disk-based multer for large media uploads to avoid OOM
const mediaUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, os.tmpdir()),
    filename: (_req, file, cb) => {
      const unique = Date.now() + "-" + Math.round(Math.random() * 1e9)
      // preserve original extension if present
      const ext = path.extname(file.originalname)
      cb(null, `${unique}${ext}`)
    },
  }),
  // Allow large files; adjust if you want a cap (e.g., 2GB)
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
})

// Only apply multer when request is multipart/form-data, and gracefully handle empty/invalid forms
const maybeMulterArray = (field: string) => {
  return (req: any, res: any, next: any) => {
    const ct = String(req.headers["content-type"] || "").toLowerCase()
    if (!ct.startsWith("multipart/form-data")) {
      // Not multipart -> treat as no files
      req.files = []
      return next()
    }
    // Use multer directly so we can intercept Busboy errors
    const handler = upload.array(field)
    handler(req, res, (err?: any) => {
      if (err) {
        const msg = String(err?.message || "")
        if (msg.includes("Unexpected end of form")) {
          // Treat malformed/empty multipart bodies as no files
          req.files = []
          return next()
        }
        return next(err)
      }
      return next()
    })
  }
}

// Only apply disk-based multer for media (large) uploads
const maybeMediaMulterArray = (field: string) => {
  return (req: any, res: any, next: any) => {
    const ct = String(req.headers["content-type"] || "").toLowerCase()
    if (!ct.startsWith("multipart/form-data")) {
      req.files = []
      return next()
    }
    const handler = mediaUpload.array(field)
    handler(req, res, (err?: any) => {
      if (err) {
        const msg = String(err?.message || "")
        if (msg.includes("Unexpected end of form")) {
          req.files = []
          return next()
        }
        return next(err)
      }
      return next()
    })
  }
}

// Adapter function to make multer middleware compatible with Medusa's middleware signature
const adaptMulter = (multerMiddleware) => {
  return (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) => {
    // Call multer middleware and capture the next function
    return multerMiddleware(req as any, res as any, (err: any) => {
      // Log after multer has processed the request
      // Continue the middleware chain
      next(err);
    });
  };
};

export default defineMiddlewares({
  routes: [
    // CORS middleware for public web routes
    {
      matcher: "/web/*",
      middlewares: [createCorsMiddleware()],
    },
    // Webhooks (no authentication required)
    {
      matcher: "/webhooks/social/facebook",
      method: "GET",
      middlewares: [], // Verification endpoint
    },
    {
      matcher: "/webhooks/social/facebook",
      method: "POST",
      middlewares: [],
      bodyParser: false, // Disable default JSON body parser for this route
    },
    {
      matcher: "/partners*",
      middlewares: [
        createCorsPartnerMiddleware(),
      ],
    },
    {
      matcher: "/partners/details",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],

    },

    {
      matcher: "/partners/update",
      method: "PUT",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
        validateAndTransformBody(wrapSchema(partnerSchema)),
      ],
    },

    {
      matcher: "/partners",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"], { allowUnregistered: true, }),
        validateAndTransformBody(wrapSchema(partnerSchema)),
      ],
    },

    {
      matcher: "/partners/:id",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
        validateAndTransformBody(wrapSchema(partnerPeopleSchema)),
      ],
    },
    {
      matcher: "/partners/:id",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/tasks",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/tasks/:taskId/accept",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/tasks/:taskId/finish",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    // Partner Assigned Tasks routes (standalone tasks)
    {
      matcher: "/partners/assigned-tasks",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/assigned-tasks/:taskId",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/assigned-tasks/:taskId/accept",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/assigned-tasks/:taskId/finish",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },

    {
      matcher: "/partners/assigned-tasks/:taskId/comments",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/assigned-tasks/:taskId/comments",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/assigned-tasks/:taskId/subtasks",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/assigned-tasks/:taskId/subtasks/:subtaskId/complete",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/currencies",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ['session', 'bearer'])
      ]
    },
    {
      matcher: "/partners/stores",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
        validateAndTransformBody(wrapSchema(PartnerCreateStoreReq)),
      ],
    },
    {
      matcher: "/partners/stores",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/products",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
        validateAndTransformBody(wrapSchema(PartnerCreateProductReq)),
      ],
    },

    {
      matcher: "/partners/stores/:id/products",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    // Partner Production Runs APIs
    {
      matcher: "/partners/production-runs",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
        validateAndTransformQuery(wrapSchema(listProductionRunsQuerySchema), {}),
      ],
    },
    {
      matcher: "/partners/production-runs/:id",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/production-runs/:id/accept",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    // Partner Inventory Orders APIs
    {
      matcher: "/partners/inventory-orders",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
        validateAndTransformQuery(wrapSchema(listInventoryOrdersQuerySchema), {}),
      ],
    },
    {
      matcher: "/partners/inventory-orders/:orderId",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/inventory-orders/:orderId/start",
      method: "POST",
      middlewares: [
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/inventory-orders/:orderId/complete",
      method: "POST",
      middlewares: [
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    // Partner Payments APIs
    {
      matcher: "/partners/:id/payments",
      method: "GET",
      middlewares: [
        authenticate("partner", ["session", "bearer"]),
        validateAndTransformQuery(wrapSchema(PartnerListPaymentsByPartnerQuerySchema), {}),
      ],
    },
    {
      matcher: "/partners/:id/payments/methods",
      method: "GET",
      middlewares: [
        authenticate("partner", ["session", "bearer"]),
        validateAndTransformQuery(wrapSchema(PartnerListPaymentMethodsByPartnerQuerySchema), {}),
      ],
    },
    {
      matcher: "/partners/:id/payments/methods",
      method: "POST",
      middlewares: [
        authenticate("partner", ["session", "bearer"]),
        validateAndTransformBody(wrapSchema(PartnerCreatePaymentMethodForPartnerSchema)),
      ],
    },
    // Admin Payments and Payment Methods
    // Payments root
    {
      matcher: "/admin/payments",
      method: "GET",
      middlewares: [validateAndTransformQuery(wrapSchema(ListPaymentsQuerySchema), {})],
    },
    {
      matcher: "/admin/payments",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(PaymentSchema))],
    },

    {
      matcher: "/admin/payments/:id",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(UpdatePaymentSchema))],
    },
    // Create payment and link to persons/partners
    {
      matcher: "/admin/payments/link",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(CreatePaymentAndLinkSchema))],
    },
    // Payments by person
    {
      matcher: "/admin/payments/persons/:id",
      method: "GET",
      middlewares: [validateAndTransformQuery(wrapSchema(ListPaymentsByPersonQuerySchema), {})],
    },
    // Payments by partner
    {
      matcher: "/admin/payments/partners/:id",
      method: "GET",
      middlewares: [validateAndTransformQuery(wrapSchema(ListPaymentsByPartnerQuerySchema), {})],
    },
    // Payment methods for person
    {
      matcher: "/admin/payments/persons/:id/methods",
      method: "GET",
      middlewares: [validateAndTransformQuery(wrapSchema(ListPaymentMethodsByPersonQuerySchema), {})],
    },
    {
      matcher: "/admin/payments/persons/:id/methods",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(CreatePaymentMethodForPersonSchema))],
    },
    // Payment methods for partner
    {
      matcher: "/admin/payments/partners/:id/methods",
      method: "GET",
      middlewares: [validateAndTransformQuery(wrapSchema(ListPaymentMethodsByPartnerQuerySchema), {})],
    },
    {
      matcher: "/admin/payments/partners/:id/methods",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(CreatePaymentMethodForPartnerSchema))],
    },

    // Payment and its methods 
    {
      matcher: "/admin/persons",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(personSchema))],
    },
    {
      matcher: "/admin/persons/:id",
      method: "DELETE",
      middlewares: [],
    },
    {
      matcher: "/admin/persons",
      method: "GET",
      middlewares: [validateAndTransformQuery(wrapSchema(listPersonsQuerySchema), {})],
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
      matcher: "/admin/persons/:id/resources/:resource",
      method: "POST",
      middlewares: [validatePersonResourceCreate],
    },
    {
      matcher: "/admin/persons/:id/resources/:resource/:resourceId",
      method: "PATCH",
      middlewares: [validatePersonResourceUpdate],
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
    // Person Import routes
    {
      matcher: "/admin/persons/import",
      method: "POST",
      middlewares: [adaptMulter(upload.single("file"))],
    },
    {
      matcher: "/admin/persons/import/:transaction_id/confirm",
      method: "POST",
      middlewares: [],
    },
    // Media routes
    {
      matcher: "/admin/medias",
      method: "POST",
      middlewares: [maybeMulterArray("files"), validateAndTransformBody(wrapSchema(uploadMediaSchema))],
    },
    // AI Image Extraction endpoint (JSON body with image_url)
    {
      matcher: "/admin/ai/image-extraction",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(AdminImageExtractionReq))],
    },
    // AI Chat endpoints (BM25 + LLM hybrid)
    {
      matcher: "/admin/ai/chat/chat",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(AdminAiChatReq))],
    },

    {
      matcher: "/admin/ai/rag/search",
      method: "GET",
      middlewares: [validateAndTransformQuery(wrapSchema(AdminRagSearchQuery), {})],
    },

    // AI Chat Query Resolution endpoints
    {
      matcher: "/admin/ai/chat/resolve",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(AdminAiChatResolveReq))],
    },
    {
      matcher: "/admin/ai/chat/resolve",
      method: "GET",
      middlewares: [validateAndTransformQuery(wrapSchema(AdminAiChatResolveQuery), {})],
    },

    // Admin Feedback routes
    {
      matcher: "/admin/feedbacks",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(FeedbackSchema))],
    },

    // Folder-scoped media uploads
    {
      matcher: "/admin/medias/folder/:id/upload",
      method: "POST",
      middlewares: [maybeMulterArray("files")],
    },
    // Legacy upload path kept for backward compatibility
    {
      matcher: "/admin/medias/:id/upload",
      method: "POST",
      middlewares: [maybeMulterArray("files")],
    },

    {
      matcher: "/admin/medias/existdir",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(folderSchema))],
    },
    // Folder creation endpoint
    {
      matcher: "/admin/medias/folder",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(folderSchema))],
    },
    // Textile Product Feature Extraction endpoints
    {
      matcher: "/admin/medias/extract-features",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(ExtractFeaturesRequestSchema))],
    },
    {
      matcher: "/admin/medias/extract-features/:transaction_id/confirm",
      method: "POST",
      middlewares: [],
    },
    // Person Types
    {
      matcher: "/admin/persontypes",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(personTypeSchema))],
    },
    {
      matcher: "/admin/persontypes/:id",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(updatePersonTypeSchema))],
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
    // Inventory orders
    {
      matcher: "/admin/inventory-orders",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(createInventoryOrdersSchema))],
    },
    {
      matcher: "/admin/inventory-orders",
      method: 'GET',
      middlewares: [validateAndTransformQuery(wrapSchema(listInventoryOrdersQuerySchema), {})]
    },
    {
      matcher: "/admin/inventory-orders/:id",
      method: 'GET',
      middlewares: [validateAndTransformQuery(wrapSchema(ReadSingleInventoryOrderQuerySchema), {})]
    },
    {
      matcher: "/admin/inventory-orders/:id",
      method: 'PUT',
      middlewares: [validateAndTransformBody(wrapSchema(updateInventoryOrdersSchema))],
    },
    {
      matcher: "/admin/inventory-orders/:id/tasks",
      method: 'POST',
      middlewares: [validateAndTransformBody(wrapSchema(AdminPostInventoryOrderTasksReq))],
    },
    {
      matcher: "/admin/inventory-orders/:id/tasks/:taskId",
      method: 'POST',
      middlewares: [validateAndTransformBody(wrapSchema(UpdateInventoryOrderTask))],
    },
    {
      matcher: "/admin/inventory-orders/:id/send-to-partner",
      method: 'POST',
      middlewares: [validateAndTransformBody(wrapSchema(sendToPartnerSchema))],
    },
    {
      matcher: "/admin/inventory-orders/:id/order-lines",
      method: 'PUT',
      middlewares: [validateAndTransformBody(wrapSchema(updateInventoryOrderLinesSchema))],
    },
    // Admin Partners routes
    {
      matcher: "/admin/partners",
      method: "GET",
      middlewares: [validateAndTransformQuery(wrapSchema(listPartnersQuerySchema), {})],
    },
    {
      matcher: "/admin/partners/:id",
      method: "GET",
      middlewares: [validateAndTransformQuery(wrapSchema(listPartnersQuerySchema), {})],
    },
    {
      matcher: "/admin/partners/:id",
      method: "PUT",
      middlewares: [],
    },
    {
      matcher: "/admin/partners",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(PostPartnerSchema))],
    },
    // Admin Partner Tasks routes
    {
      matcher: "/admin/partners/:id/tasks",
      method: "GET",
      middlewares: [],
    },
    {
      matcher: "/admin/partners/:id/tasks",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(AdminCreatePartnerTaskReq))],
    },
    {
      matcher: "/admin/partners/:id/tasks/:taskId/assign",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(AdminPostPartnerTaskAssignReq))],
    },
    {
      matcher: "/admin/persons/partner",
      method: "GET",
      middlewares: [validateAndTransformQuery(wrapSchema(AdminGetPartnersParamsSchema), {})],
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

    {
      matcher: "/admin/designs/:id/inventory/delink",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(AdminDeleteDesignInventoryReq))],
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

    {
      matcher: "/admin/designs/auto",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(CreateDesignLLMSchema))],
    },

    // Store AI endpoints
    {
      matcher: "/store/ai/imagegen",
      method: "POST",
      middlewares: [
        authenticate("customer", ["session", "bearer"]),
        validateAndTransformBody(wrapSchema(StoreGenerateAiImageReqSchema)),
      ],
    },
    // Store design endpoints - cost estimation and checkout
    {
      matcher: "/store/custom/designs/:id/estimate",
      method: "GET",
      middlewares: [
        authenticate("customer", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/store/custom/designs/:id/checkout",
      method: "POST",
      middlewares: [
        authenticate("customer", ["session", "bearer"]),
      ],
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

    {
      matcher: "/admin/production-runs",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(AdminCreateProductionRunReq))],
    },
    {
      matcher: "/admin/production-runs/:id/approve",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(AdminApproveProductionRunReq))],
    },
    {
      matcher: "/admin/production-runs/:id/send-to-production",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(AdminSendProductionRunToProductionReq))],
    },
    {
      matcher: "/admin/production-runs/:id/start-dispatch",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(AdminStartDispatchProductionRunReq))],
    },
    {
      matcher: "/admin/production-runs/:id/resume-dispatch",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(AdminResumeDispatchProductionRunReq))],
    },

    {
      matcher: "/admin/production-run-policy",
      method: "GET",
      middlewares: [],
    },
    {
      matcher: "/admin/production-run-policy",
      method: "PUT",
      middlewares: [
        validateAndTransformBody(wrapSchema(AdminUpdateProductionRunPolicySchema)),
      ],
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
      matcher: "/admin/websites/:id/pages/:pageId/subs/:workflowId/confirm",
      method: "POST",
      middlewares: [],
    },
    {
      matcher: "/admin/websites/:id/pages/:pageId/subs",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(SendBlogSubscriptionSchema))],
    },
    {
      matcher: "/admin/websites/:id/pages/:pageId/subs/test",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(TestBlogEmailSchema))],
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
    {
      matcher: "/web/website/:domain/subscribe",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(subscriptionSchema))],
    },
    {
      matcher: "/web/website/:domain/forms/:handle",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(webSubmitFormResponseSchema))],
    },
    {
      matcher: "/web/website/:domain/forms/:handle/schema",
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

    {
      matcher: "/admin/inventory-items/raw-materials",
      method: "GET",
      middlewares: [validateAndTransformQuery(wrapSchema(ListInventoryItemRawMaterialsQuerySchema), {})],
    },

    {
      matcher: "/admin/social-platforms",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(SocialPlatformSchema))],
    },

    {
      matcher: "/admin/social-posts",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(SocialPostSchema))],
    },

    {
      matcher: "/admin/social-posts/:socialPostId",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(UpdateSocialPostSchema))],
    },

    {
      matcher: "/admin/social-platforms/:socialPlatformId",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(UpdateSocialPlatformSchema))],
    },

    {
      matcher: "/admin/social-platforms",
      method: "GET",
      middlewares: [validateAndTransformQuery(wrapSchema(listSocialPlatformsQuerySchema), {})],
    },
    {
      matcher: "/admin/social-posts",
      method: "GET",
      middlewares: [validateAndTransformQuery(wrapSchema(listSocialPostsQuerySchema), {})],
    },
    {
      matcher: "/admin/social-posts/:id/publish",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(PublishSocialPostSchema))],
    },
    {
      matcher: "/admin/socials/accounts",
      method: "GET",
      middlewares: [validateAndTransformQuery(wrapSchema(GetAccountsSchema), {})],
    },
    // Publishing Campaigns routes
    {
      matcher: "/admin/publishing-campaigns",
      method: "GET",
      middlewares: [validateAndTransformQuery(wrapSchema(ListPublishingCampaignsQuerySchema), {})],
    },
    {
      matcher: "/admin/publishing-campaigns",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(CreatePublishingCampaignSchema))],
    },
    {
      matcher: "/admin/publishing-campaigns/:id",
      method: "GET",
      middlewares: [],
    },
    {
      matcher: "/admin/publishing-campaigns/:id",
      method: "PUT",
      middlewares: [validateAndTransformBody(wrapSchema(UpdatePublishingCampaignSchema))],
    },
    {
      matcher: "/admin/publishing-campaigns/:id",
      method: "DELETE",
      middlewares: [],
    },
    {
      matcher: "/admin/publishing-campaigns/:id/start",
      method: "POST",
      middlewares: [],
    },
    {
      matcher: "/admin/publishing-campaigns/:id/pause",
      method: "POST",
      middlewares: [],
    },
    {
      matcher: "/admin/publishing-campaigns/:id/cancel",
      method: "POST",
      middlewares: [],
    },
    {
      matcher: "/admin/publishing-campaigns/:id/preview",
      method: "POST",
      middlewares: [],
    },
    {
      matcher: "/admin/publishing-campaigns/:id/retry-item",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(RetryItemSchema))],
    },
    {
      matcher: "/admin/publishing-campaigns/:id/retry-all",
      method: "POST",
      middlewares: [],
    },
    {
      matcher: "/admin/users/:id/suspend",
      method: "POST",
      middlewares: [],
    },
    {
      matcher: "/admin/persons/:id/geocode-addresses",
      method: "POST",
      middlewares: [],
    },
    {
      matcher: "/admin/persons/geocode-addresses/:transaction_id/confirm",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(ConfirmBody))],
    },
    {
      matcher: "/web/persons",
      method: "GET",
      middlewares: [validateAndTransformQuery(wrapSchema(listPublicPersonsQuerySchema), {})],
    },
    {
      matcher: "/admin/products/:id/linkDesign",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(LinkDesignValidator))],
    },
    {
      matcher: "/admin/products/:id/unlinkDesign",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(UnlinkDesignValidator))],
    },
    // People and Design Link
    {
      matcher: "/admin/products/:id/linkPerson",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(LinkPersonValidator))],
    },
    {
      matcher: "/admin/products/:id/unlinkPerson",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(UnlinkPersonValidator))],
    },
    {
      matcher: "/admin/products/:id/generateDescription",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(GenerateDescriptionValidator))],
    },
    // Store management APIs

    {
      matcher: "/admin/stores",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(createStoreSchema))],
    },
    // Email Templates 
    {
      matcher: "/admin/email-templates",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(EmailTemplateSchema))],
    },
    {
      matcher: "/admin/email-templates",
      method: "GET",
      middlewares: [validateAndTransformQuery(wrapSchema(EmailTemplateQueryParams), {})],
    },
    // Notifications (custom listing endpoint to avoid overriding core /admin/notifications)
    {
      matcher: "/admin/notifications/custom",
      method: "GET",
      middlewares: [validateAndTransformQuery(wrapSchema(AdminNotificationsQueryParams), {})],
    },
    {
      matcher: "/admin/email-templates/:id",
      method: "GET",
      middlewares: [validateAndTransformQuery(wrapSchema(EmailTemplateQueryParams), {})],
    },
    {
      matcher: "/admin/email-templates/:id",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(UpdateEmailTemplateSchema))],
    },
    {
      matcher: "/admin/agreements",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(CreateAgreementSchema))],
    },
    {
      matcher: "/admin/agreements/:id",
      method: "DELETE",
      middlewares: [],
    },
    {
      matcher: "/admin/agreements/:id",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(UpdateAgreementSchema))],
    },
    // Forms
    {
      matcher: "/admin/forms",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(AdminCreateFormSchema))],
    },
    {
      matcher: "/admin/forms",
      method: "GET",
      middlewares: [validateAndTransformQuery(wrapSchema(AdminListFormsQuerySchema), {})],
    },
    {
      matcher: "/admin/forms/:id",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(AdminUpdateFormSchema))],
    },
    {
      matcher: "/admin/forms/:id",
      method: "DELETE",
      middlewares: [],
    },
    {
      matcher: "/admin/forms/:id/fields",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(AdminSetFormFieldsSchema))],
    },
    {
      matcher: "/admin/forms/:id/responses",
      method: "GET",
      middlewares: [
        validateAndTransformQuery(wrapSchema(AdminListFormResponsesQuerySchema), {}),
      ],
    },
    {
      matcher: "/admin/forms/:id/responses/:response_id",
      method: "GET",
      middlewares: [],
    },
    {
      matcher: "/admin/persons/:id/agreements/send",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(AdminSendPersonAgreementReq))],
    },
    {
      matcher: "/admin/designs/:id/partner",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(LinkDesignPartnerSchema))],
    },
    // Admin Designs -> send to partner
    {
      matcher: "/admin/designs/:id/send-to-partner",
      method: 'POST',
      middlewares: [validateAndTransformBody(wrapSchema(sendDesignToPartnerSchema))],
    },
    {
      matcher: "/admin/designs/:id/production-runs",
      method: "POST",
      middlewares: [
        validateAndTransformBody(wrapSchema(AdminCreateDesignProductionRunSchema)),
      ],
    },
    // Partner Designs APIs
    {
      matcher: "/partners/designs",
      method: "GET",
      middlewares: [
        authenticate("partner", ["session", "bearer"]),
        validateAndTransformQuery(wrapSchema(listDesignsQuerySchema), {}),
      ],
    },
    {
      matcher: "/partners/designs/:designId",
      method: "GET",
      middlewares: [
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/designs/:designId/start",
      method: "POST",
      middlewares: [
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/designs/:designId/redo",
      method: "POST",
      middlewares: [
        authenticate("partner", ["session", "bearer"]),
      ],
    },

    {
      matcher: "/partners/designs/:designId/refinish",
      method: "POST",
      middlewares: [
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/designs/:designId/finish",
      method: "POST",
      middlewares: [
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/designs/:designId/inventory",
      method: "POST",
      middlewares: [
        authenticate("partner", ["session", "bearer"]),
        validateAndTransformBody(wrapSchema(PartnerDesignInventorySchema)),
      ],
    },
    {
      matcher: "/partners/designs/:designId/complete",
      method: "POST",
      middlewares: [
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/designs/:designId/media",
      method: "POST",
      middlewares: [
        authenticate("partner", ["session", "bearer"]),
        maybeMulterArray("files"),
      ],
    },
    {
      matcher: "/partners/designs/:designId/media/attach",
      method: "POST",
      middlewares: [
        authenticate("partner", ["session", "bearer"]),
        // JSON body is handled by default express.json; no multer needed here
      ],
    },
    // Partner multipart upload endpoints (bypass Netlify 8MB limit)
    {
      matcher: "/partners/medias/uploads/initiate",
      method: "POST",
      middlewares: [authenticate("partner", ["session", "bearer"])],
    },
    {
      matcher: "/partners/medias/uploads/parts",
      method: "POST",
      middlewares: [authenticate("partner", ["session", "bearer"])],
    },
    {
      matcher: "/partners/medias/uploads/complete",
      method: "POST",
      middlewares: [authenticate("partner", ["session", "bearer"])],
    },
    // Admin Users: list auth identities by email
    {
      matcher: "/admin/users/identities",
      method: "GET",
      middlewares: [validateAndTransformQuery(wrapSchema(ListIdentitiesQuerySchema), {})],
    },
    {
      matcher: "/admin/users/:id/suspend",
      method: "POST",
      middlewares: [],
    },
    // Admin Feedbacks routes
    {
      matcher: "/admin/feedbacks",
      method: "GET",
      middlewares: [],
    },
    {
      matcher: "/admin/feedbacks",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(FeedbackSchema))],
    },
    // Admin Analytics Events routes
    {
      matcher: "/admin/analytics-events",
      method: "GET",
      middlewares: [validateAndTransformQuery(wrapSchema(AnalyticsEventQuerySchema), {})],
    },
    {
      matcher: "/admin/feedbacks/:id",
      method: "GET",
      middlewares: [],
    },
    {
      matcher: "/admin/feedbacks/:id",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(UpdateFeedbackSchema))],
    },
    {
      matcher: "/admin/feedbacks/:id",
      method: "DELETE",
      middlewares: [],
    },
    // Entity-specific feedback routes
    {
      matcher: "/admin/partners/:id/feedbacks",
      method: "GET",
      middlewares: [],
    },
    {
      matcher: "/admin/partners/:id/feedbacks",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(FeedbackSchema))],
    },
    {
      matcher: "/admin/tasks/:id/feedbacks",
      method: "GET",
      middlewares: [],
    },
    {
      matcher: "/admin/tasks/:id/feedbacks",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(FeedbackSchema))],
    },
    {
      matcher: "/admin/inventory-orders/:id/feedbacks",
      method: "GET",
      middlewares: [],
    },
    {
      matcher: "/admin/inventory-orders/:id/feedbacks",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(FeedbackSchema))],
    },
    // Meta Ads routes
    {
      matcher: "/admin/meta-ads/leads",
      method: "GET",
      middlewares: [validateAndTransformQuery(wrapSchema(ListLeadsQuerySchema), {})],
    },
    {
      matcher: "/admin/meta-ads/leads/:id",
      method: "GET",
      middlewares: [],
    },
    {
      matcher: "/admin/meta-ads/leads/:id",
      method: "PATCH",
      middlewares: [validateAndTransformBody(wrapSchema(UpdateLeadSchema))],
    },
    {
      matcher: "/admin/meta-ads/leads/:id",
      method: "DELETE",
      middlewares: [],
    },
    {
      matcher: "/admin/meta-ads/leads/sync",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(SyncLeadsSchema))],
    },
    {
      matcher: "/admin/meta-ads/accounts",
      method: "GET",
      middlewares: [],
    },
    {
      matcher: "/admin/meta-ads/accounts/sync",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(SyncAdAccountsSchema))],
    },
    {
      matcher: "/admin/meta-ads/campaigns",
      method: "GET",
      middlewares: [validateAndTransformQuery(wrapSchema(ListCampaignsQuerySchema), {})],
    },
    {
      matcher: "/admin/meta-ads/campaigns/sync",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(SyncCampaignsSchema))],
    },
    {
      matcher: "/admin/meta-ads/insights/sync",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(SyncInsightsSchema))],
    },
    {
      matcher: "/admin/meta-ads/overview",
      method: "GET",
      middlewares: [validateAndTransformQuery(wrapSchema(MetaAdsOverviewQuerySchema), {})],
    },
    {
      matcher: "/admin/meta-ads/remote/ads",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(CreateRemoteAdSchema))],
    },
  ],
  errorHandler: ((
    error: any, // or whatever type you prefer
    req,
    res,
    next
  ) => {
    // Only log errors in non-test environments to keep test output clean
    if (!process.env.TEST_TYPE) {
      console.log(error);
    }
    // Option 1: standard name check
    // if (error.name === "ZodError") {
    // Option 2: check if error is an instance of ZodError
    if (error.__isMedusaError) {
      if (error.type == 'not_found') {
        return res.status(404).json({
          message: error.message,
        });
      } else {
        return res.status(400).json({
          message: error.message,
        });
      }
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

      // Create a single error message that includes code and path for each issue
      const errorMessage = formattedIssues.map(issue =>
        `${issue.code} ${issue.message} (at path: ${issue.path})`
      ).join('; ');

      return res.status(400).json({
        message: errorMessage,
        //details: formattedIssues // Keep the detailed issues for debugging
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
