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
import { z } from "@medusajs/framework/zod";
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
import { splitInventorySchema } from "./admin/inventory-items/[id]/split/validators";
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
import { partnerSchema, partnerUpdateSchema } from "./partners/validators";
import { partnerPeopleSchema } from "./partners/[id]/validators";
import { AdminGetPartnersParamsSchema } from "./admin/persons/partner/validators";
import { createInventoryOrdersSchema, listInventoryOrdersQuerySchema, ReadSingleInventoryOrderQuerySchema, updateInventoryOrdersSchema, updateInventoryOrderLinesSchema } from "./admin/inventory-orders/validators";
// Import already defined above
import { SendBlogSubscriptionSchema } from "./admin/websites/[id]/pages/[pageId]/subs/route";
import { subscriptionSchema } from "./web/website/[domain]/validators";
import { websiteThemeSchema } from "./partners/storefront/website/theme/validators";
import { createPlanSchema, updatePlanSchema, createSubscriptionSchema } from "./admin/partner-plans/validators";
import { subscribeSchema as partnerSubscribeSchema } from "./partners/subscription/validators";
import { AdminPostInventoryOrderTasksReq } from "./admin/inventory-orders/[id]/tasks/validators";
import { createStoreSchema } from "./admin/stores/validators";
import { UpdateInventoryOrderTask } from "./admin/inventory-orders/[id]/tasks/[taskId]/validators";
import { TestBlogEmailSchema } from "./admin/websites/[id]/pages/[pageId]/subs/test/route";
import { listSocialPlatformsQuerySchema, SocialPlatformSchema, UpdateSocialPlatformSchema } from "./admin/social-platforms/validators";
import { StoreGenerateAiImageReqSchema } from "./store/ai/imagegen/validators";
import { StoreTryOnReqSchema } from "./store/ai/tryon/validators";
import { AccessFeeConfirmSchema } from "./store/ai/accessfee/validators";
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
import {
  ReportingQuerySchema,
  CreatePaymentReportSchema,
  ListPaymentReportsQuerySchema,
  UpdatePaymentReportSchema,
} from "./admin/payment_reports/validators";
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
import {
  PartnerCreateRegionReq,
  PartnerUpdateRegionReq,
  PartnerUpdateLocationReq,
  PartnerCreateFulfillmentSetReq,
  PartnerUpdateFulfillmentProvidersReq,
  PartnerCreateShippingOptionReq,
  PartnerUpdateShippingOptionReq,
  PartnerUpdateStoreReq,
  PartnerCreateSalesChannelReq,
  PartnerUpdateSalesChannelReq,
  PartnerCreateTaxRegionReq,
  PartnerUpdateTaxRegionReq,
} from "./partners/stores/[id]/validators";
import {
  listInboundEmailsQuerySchema,
  extractInboundEmailSchema,
  executeInboundEmailSchema,
  syncInboundEmailsSchema,
  testConnectionSchema,
} from "./admin/inbound-emails/validators";
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
import { webSubmitFormResponseSchema, webVerifyFormResponseSchema } from "./web/website/[domain]/forms/[handle]/validators";
import { LinkDesignsToCustomerSchema } from "./admin/customers/[id]/designs/validators";
import { CreateDesignOrderSchema } from "./admin/customers/[id]/design-order/validators";

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
const adaptMulter = (multerMiddleware: any) => {
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
      matcher: "/webhooks/inbound-email/resend",
      method: "POST",
      middlewares: [],
      bodyParser: false, // Need raw body for Svix signature verification
    },
    {
      matcher: "/webhooks/meta-ads/leadgen",
      method: "GET",
      middlewares: [],
    },
    {
      matcher: "/webhooks/meta-ads/leadgen",
      method: "POST",
      middlewares: [],
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
      matcher: "/partners/admins",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/admins",
      method: "POST",
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
        validateAndTransformBody(wrapSchema(partnerUpdateSchema)),
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
    // Partner Store Regions
    {
      matcher: "/partners/stores/:id/regions",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/stores/:id/regions",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
        validateAndTransformBody(wrapSchema(PartnerCreateRegionReq)),
      ],
    },
    {
      matcher: "/partners/stores/:id/regions/:regionId",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/stores/:id/regions/:regionId",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
        validateAndTransformBody(wrapSchema(PartnerUpdateRegionReq)),
      ],
    },
    {
      matcher: "/partners/stores/:id/regions/:regionId",
      method: "DELETE",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    // Partner Store Locations
    {
      matcher: "/partners/stores/:id/locations",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/stores/:id/locations",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/stores/:id/locations/:locationId",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/stores/:id/locations/:locationId",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
        validateAndTransformBody(wrapSchema(PartnerUpdateLocationReq)),
      ],
    },
    {
      matcher: "/partners/stores/:id/locations/:locationId",
      method: "DELETE",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/stores/:id/locations/:locationId/sales-channels",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/stores/:id/locations/:locationId/fulfillment-sets",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
        validateAndTransformBody(wrapSchema(PartnerCreateFulfillmentSetReq)),
      ],
    },
    {
      matcher: "/partners/stores/:id/locations/:locationId/fulfillment-providers",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
        validateAndTransformBody(wrapSchema(PartnerUpdateFulfillmentProvidersReq)),
      ],
    },
    // Partner Store Fulfillment Sets
    {
      matcher: "/partners/stores/:id/fulfillment-sets/:fulfillmentSetId",
      method: "DELETE",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/stores/:id/fulfillment-sets/:fulfillmentSetId/service-zones",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/stores/:id/fulfillment-sets/:fulfillmentSetId/service-zones/:serviceZoneId",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/stores/:id/fulfillment-sets/:fulfillmentSetId/service-zones/:serviceZoneId",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/stores/:id/fulfillment-sets/:fulfillmentSetId/service-zones/:serviceZoneId",
      method: "DELETE",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    // Partner Store Product Variants
    {
      matcher: "/partners/stores/:id/product-variants",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    // Partner Store Shipping Options
    {
      matcher: "/partners/stores/:id/shipping-options",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/stores/:id/shipping-options",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
        validateAndTransformBody(wrapSchema(PartnerCreateShippingOptionReq)),
      ],
    },
    {
      matcher: "/partners/stores/:id/shipping-options/:optionId",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/stores/:id/shipping-options/:optionId",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
        validateAndTransformBody(wrapSchema(PartnerUpdateShippingOptionReq)),
      ],
    },
    {
      matcher: "/partners/stores/:id/shipping-options/:optionId",
      method: "DELETE",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    // Partner Shipping Profiles
    {
      matcher: "/partners/shipping-profiles",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/shipping-profiles",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    // Partner Shipping Option Types
    {
      matcher: "/partners/shipping-option-types",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/shipping-option-types",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/shipping-option-types/:id",
      method: ["GET", "POST", "DELETE"],
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    // Partner Fulfillment Providers
    {
      matcher: "/partners/fulfillment-providers",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/fulfillment-providers/:providerId/options",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    // Partner Product Categories
    {
      matcher: "/partners/product-categories",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/product-categories",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/product-categories/:id",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/product-categories/:id",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/product-categories/:id",
      method: "DELETE",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/product-categories/:id/products",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    // Partner Product Collections, Types, Tags
    {
      matcher: "/partners/product-collections",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/product-collections",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/product-collections/:id",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/product-collections/:id",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/product-collections/:id",
      method: "DELETE",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/product-collections/:id/products",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/product-types",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/product-types",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/product-types/:id",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/product-types/:id",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/product-types/:id",
      method: "DELETE",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/product-tags",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    // Partner Discover Products
    {
      matcher: "/partners/discover/products",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/discover/products/:id/copy",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    // Partner Inventory Items
    {
      matcher: "/partners/inventory-items",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/inventory-items",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/inventory-items/batch-levels",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/inventory-items/:id",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/inventory-items/:id",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/inventory-items/:id",
      method: "DELETE",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/inventory-items/:id/levels",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/inventory-items/:id/levels/batch",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/inventory-items/:id/levels/:locationId",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/inventory-items/:id/levels/:locationId",
      method: "DELETE",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    // Partner Payment Providers
    {
      matcher: "/partners/payment-providers",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    // Partner Payment Config (per-partner credentials)
    {
      matcher: "/partners/payment-config",
      method: ["GET", "POST"],
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/payment-config/:configId",
      method: ["GET", "POST", "DELETE"],
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    // Partner Tax Providers
    {
      matcher: "/partners/tax-providers",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    // Partner Tax Rates
    {
      matcher: "/partners/tax-rates",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/tax-rates",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/tax-rates/:id",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/tax-rates/:id",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/tax-rates/:id",
      method: "DELETE",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    // Partner Storefront
    {
      matcher: "/partners/storefront",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/storefront",
      method: "DELETE",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/storefront/provision",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/storefront/redeploy",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    // Partner Storefront Domain
    {
      matcher: "/partners/storefront/domain",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/storefront/domain",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/storefront/domain",
      method: "DELETE",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/storefront/domain/verify",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    // Partner Storefront Website
    {
      matcher: "/partners/storefront/website",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/storefront/website",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    // Partner Storefront Pages
    {
      matcher: "/partners/storefront/pages",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/storefront/pages",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
        validateAndTransformBody(wrapSchema(postPagesSchema)),
      ],
    },
    {
      matcher: "/partners/storefront/pages/:pageId",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/storefront/pages/:pageId",
      method: "PUT",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
        validateAndTransformBody(wrapSchema(updatePageSchema)),
      ],
    },
    {
      matcher: "/partners/storefront/pages/:pageId",
      method: "DELETE",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    // Partner Storefront Blocks
    {
      matcher: "/partners/storefront/pages/:pageId/blocks",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/storefront/pages/:pageId/blocks",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
        validateAndTransformBody(wrapSchema(createBlocksSchema)),
      ],
    },
    {
      matcher: "/partners/storefront/pages/:pageId/blocks/:blockId",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/storefront/pages/:pageId/blocks/:blockId",
      method: "PUT",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
        validateAndTransformBody(wrapSchema(updateBlockSchema)),
      ],
    },
    {
      matcher: "/partners/storefront/pages/:pageId/blocks/:blockId",
      method: "DELETE",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    // Partner Storefront Seed Pages
    {
      matcher: "/partners/storefront/seed-pages",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    // Partner Storefront Website Theme
    {
      matcher: "/partners/storefront/website/theme",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/storefront/website/theme",
      method: "PUT",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
        validateAndTransformBody(wrapSchema(websiteThemeSchema)),
      ],
    },
    // Partner Subscription
    {
      matcher: "/partners/subscription",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/subscription",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
        validateAndTransformBody(wrapSchema(partnerSubscribeSchema)),
      ],
    },
    {
      matcher: "/partners/subscription",
      method: "DELETE",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    // PayU subscription callback (unauthenticated — called by PayU)
    {
      matcher: "/partners/subscription/payu/complete",
      method: "POST",
      middlewares: [],
    },
    // Partner Price Preferences
    {
      matcher: "/partners/price-preferences",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/price-preferences",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/price-preferences/:id",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/price-preferences/:id",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/price-preferences/:id",
      method: "DELETE",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    // Partner API Keys
    {
      matcher: "/partners/api-keys",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/api-keys",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/api-keys/:id",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/api-keys/:id",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/api-keys/:id",
      method: "DELETE",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/api-keys/:id/revoke",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/api-keys/:id/sales-channels",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    // Partner Store Detail
    {
      matcher: "/partners/stores/:id",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/stores/:id",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
        validateAndTransformBody(wrapSchema(PartnerUpdateStoreReq)),
      ],
    },
    // Partner Store Sales Channels
    {
      matcher: "/partners/stores/:id/sales-channels",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/stores/:id/sales-channels",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
        validateAndTransformBody(wrapSchema(PartnerCreateSalesChannelReq)),
      ],
    },
    {
      matcher: "/partners/stores/:id/sales-channels/:channelId",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/stores/:id/sales-channels/:channelId",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
        validateAndTransformBody(wrapSchema(PartnerUpdateSalesChannelReq)),
      ],
    },
    {
      matcher: "/partners/stores/:id/sales-channels/:channelId",
      method: "DELETE",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    // Partner Store Tax Regions
    {
      matcher: "/partners/stores/:id/tax-regions",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/stores/:id/tax-regions",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
        validateAndTransformBody(wrapSchema(PartnerCreateTaxRegionReq)),
      ],
    },
    {
      matcher: "/partners/stores/:id/tax-regions/:taxRegionId",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/stores/:id/tax-regions/:taxRegionId",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
        validateAndTransformBody(wrapSchema(PartnerUpdateTaxRegionReq)),
      ],
    },
    {
      matcher: "/partners/stores/:id/tax-regions/:taxRegionId",
      method: "DELETE",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    // Partner Store Products
    {
      matcher: "/partners/stores/:id/products",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/stores/:id/products/:productId",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/stores/:id/products/:productId",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/stores/:id/products/:productId",
      method: "DELETE",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    // Partner Store Product Variants
    {
      matcher: "/partners/stores/:id/products/:productId/variants",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/stores/:id/products/:productId/variants",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/stores/:id/products/:productId/variants/:variantId",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/stores/:id/products/:productId/variants/:variantId",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/stores/:id/products/:productId/variants/:variantId",
      method: "DELETE",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    // Partner Store Product Options
    {
      matcher: "/partners/stores/:id/products/:productId/options",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/stores/:id/products/:productId/options/:optionId",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/stores/:id/products/:productId/options/:optionId",
      method: "DELETE",
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
    {
      matcher: "/partners/inventory-orders/:orderId/submit-payment",
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

    // ── Partner Plans ──────────────────────────────────────────────────────
    {
      matcher: "/admin/partner-plans",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(createPlanSchema))],
    },
    {
      matcher: "/admin/partner-plans/:id",
      method: "PUT",
      middlewares: [validateAndTransformBody(wrapSchema(updatePlanSchema))],
    },
    // ── Partner Subscriptions (Admin) ────────────────────────────────────
    {
      matcher: "/admin/partner-subscriptions",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(createSubscriptionSchema))],
    },

    // ── Payment Reports ──────────────────────────────────────────────────────
    // Static sub-routes MUST come before /:id to avoid shadowing
    {
      matcher: "/admin/payment_reports/summary",
      method: "GET",
      middlewares: [validateAndTransformQuery(wrapSchema(ReportingQuerySchema), {})],
    },
    {
      matcher: "/admin/payment_reports/by-partner",
      method: "GET",
      middlewares: [validateAndTransformQuery(wrapSchema(ReportingQuerySchema), {})],
    },
    {
      matcher: "/admin/payment_reports/by-person",
      method: "GET",
      middlewares: [validateAndTransformQuery(wrapSchema(ReportingQuerySchema), {})],
    },
    {
      matcher: "/admin/payment_reports",
      method: "GET",
      middlewares: [validateAndTransformQuery(wrapSchema(ListPaymentReportsQuerySchema), {})],
    },
    {
      matcher: "/admin/payment_reports",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(CreatePaymentReportSchema))],
    },
    {
      matcher: "/admin/payment_reports/:id",
      method: "PATCH",
      middlewares: [validateAndTransformBody(wrapSchema(UpdatePaymentReportSchema))],
    },
    {
      matcher: "/admin/payment_reports/:id",
      method: "DELETE",
      middlewares: [],
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
    // Hang tag settings
    {
      matcher: "/admin/hang-tag-settings",
      method: "GET",
      middlewares: [],
    },
    {
      matcher: "/admin/hang-tag-settings",
      method: "PUT",
      middlewares: [],
    },

    // Inventory Split
    {
      matcher: "/admin/inventory-items/:id/split",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(splitInventorySchema))],
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
    // Inbound Emails routes
    {
      matcher: "/admin/inbound-emails",
      method: "GET",
      middlewares: [validateAndTransformQuery(wrapSchema(listInboundEmailsQuerySchema), {})],
    },
    {
      matcher: "/admin/inbound-emails/sync",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(syncInboundEmailsSchema))],
    },
    // Static sub-routes must come before /:id to prevent dynamic segment shadowing in prod
    {
      matcher: "/admin/inbound-emails/test-connection",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(testConnectionSchema))],
    },
    {
      matcher: "/admin/inbound-emails/actions",
      method: "GET",
      middlewares: [],
    },
    {
      matcher: "/admin/inbound-emails/setup-resend-webhook",
      method: "POST",
      middlewares: [],
    },
    {
      matcher: "/admin/inbound-emails/:id/extract",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(extractInboundEmailSchema))],
    },
    {
      matcher: "/admin/inbound-emails/:id/execute",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(executeInboundEmailSchema))],
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
    // Admin Partner Subscription
    {
      matcher: "/admin/partners/:id/subscription",
      method: ["GET", "POST", "DELETE"],
      middlewares: [],
    },
    // Admin Partner Storefront Provisioning
    {
      matcher: "/admin/partners/:id/storefront",
      method: "GET",
      middlewares: [],
    },
    {
      matcher: "/admin/partners/:id/storefront/provision",
      method: "POST",
      middlewares: [],
    },
    {
      matcher: "/admin/partners/:id/storefront/redeploy",
      method: "POST",
      middlewares: [],
    },
    // Admin Partner Admins routes
    {
      matcher: "/admin/partners/:id/admins",
      method: "GET",
      middlewares: [],
    },
    {
      matcher: "/admin/partners/:id/admins",
      method: "POST",
      middlewares: [],
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
      matcher: "/admin/designs/orders",
      method: "GET",
      middlewares: [authenticate("user", ["session", "bearer"])],
    },
    {
      matcher: "/admin/designs/orders/:lineItemId",
      method: "GET",
      middlewares: [authenticate("user", ["session", "bearer"])],
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

    // Customer notification for designs
    {
      matcher: "/admin/designs/:id/notify-customer",
      method: "POST",
      middlewares: [],
    },

    // Media folder linking on designs
    {
      matcher: "/admin/designs/:id/link-media-folder",
      method: "POST",
      middlewares: [],
    },
    {
      matcher: "/admin/designs/:id/link-media-folder",
      method: "DELETE",
      middlewares: [],
    },

    // Link designs to customer + convert to draft order
    {
      matcher: "/admin/customers/:id/designs/ordered",
      method: "GET",
      middlewares: [
        authenticate("user", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/admin/customers/:id/designs",
      method: "POST",
      middlewares: [
        authenticate("user", ["session", "bearer"]),
        validateAndTransformBody(wrapSchema(LinkDesignsToCustomerSchema)),
      ],
    },
    {
      matcher: "/admin/customers/:id/design-order",
      method: "POST",
      middlewares: [
        authenticate("user", ["session", "bearer"]),
        validateAndTransformBody(wrapSchema(CreateDesignOrderSchema)),
      ],
    },
    {
      matcher: "/admin/customers/:id/design-order/preview",
      method: "POST",
      middlewares: [
        authenticate("user", ["session", "bearer"]),
        validateAndTransformBody(wrapSchema(CreateDesignOrderSchema)),
      ],
    },

    // PayU payment (called by storefront after redirect)
    {
      matcher: "/store/payu/complete",
      method: "POST",
      middlewares: [],
    },
    {
      matcher: "/store/payu/refresh",
      method: "POST",
      middlewares: [],
    },
    // Store AI access fee endpoints
    {
      matcher: "/store/ai/accessfee",
      method: "POST",
      middlewares: [authenticate("customer", ["session", "bearer"])],
    },
    {
      matcher: "/store/ai/accessfee/confirm",
      method: "POST",
      middlewares: [
        authenticate("customer", ["session", "bearer"]),
        validateAndTransformBody(wrapSchema(AccessFeeConfirmSchema)),
      ],
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
    {
      matcher: "/store/ai/tryon",
      method: "POST",
      bodyParser: { sizeLimit: "20mb" },
      middlewares: [
        authenticate("customer", ["session", "bearer"]),
        validateAndTransformBody(wrapSchema(StoreTryOnReqSchema)),
      ],
    },
    // Store upload presign — authenticated customers can get presigned URLs for design layer images
    {
      matcher: "/store/uploads/presign",
      method: "POST",
      middlewares: [
        authenticate("customer", ["session", "bearer"]),
      ],
    },
    // Store design create — allow larger bodies for thumbnail data URLs
    {
      matcher: "/store/custom/designs",
      method: "POST",
      bodyParser: { sizeLimit: "5mb" },
      middlewares: [
        authenticate("customer", ["session", "bearer"]),
      ],
    },
    // Store design update
    {
      matcher: "/store/custom/designs/:id",
      method: "PUT",
      bodyParser: { sizeLimit: "5mb" },
      middlewares: [
        authenticate("customer", ["session", "bearer"]),
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
      matcher: "/web/website/:domain/forms/:handle/verify",
      method: "POST",
      middlewares: [validateAndTransformBody(wrapSchema(webVerifyFormResponseSchema))],
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
      method: ["POST", "PUT"],
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
      matcher: "/admin/products/:id/hang-tag",
      method: "GET",
      middlewares: [],
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
      matcher: "/admin/designs/:id/approve",
      method: "POST",
      middlewares: [authenticate("user", ["session", "bearer"])],
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
    // Design components (bundling)
    {
      matcher: "/admin/designs/:id/components",
      method: "GET",
      middlewares: [],
    },
    {
      matcher: "/admin/designs/:id/components",
      method: "POST",
      middlewares: [],
    },
    {
      matcher: "/admin/designs/:id/components/:componentId",
      method: "PATCH",
      middlewares: [],
    },
    {
      matcher: "/admin/designs/:id/components/:componentId",
      method: "DELETE",
      middlewares: [],
    },
    {
      matcher: "/admin/designs/:id/used-in",
      method: "GET",
      middlewares: [],
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
      bodyParser: false,
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
    // Partner file uploads (product images, etc.)
    {
      matcher: "/partners/uploads",
      method: "POST",
      bodyParser: false,
      middlewares: [
        authenticate("partner", ["session", "bearer"]),
        adaptMulter(upload.array("files")),
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
    // Partner customer endpoints
    {
      matcher: "/partners/customers",
      method: ["GET", "POST"],
      middlewares: [authenticate("partner", ["session", "bearer"])],
    },
    {
      matcher: "/partners/customers/:id",
      method: ["GET", "POST", "DELETE"],
      middlewares: [authenticate("partner", ["session", "bearer"])],
    },
    {
      matcher: "/partners/customers/:id/addresses",
      method: ["GET", "POST"],
      middlewares: [authenticate("partner", ["session", "bearer"])],
    },
    {
      matcher: "/partners/customers/:id/addresses/:addressId",
      method: ["GET", "POST", "DELETE"],
      middlewares: [authenticate("partner", ["session", "bearer"])],
    },
    {
      matcher: "/partners/customers/:id/customer-groups",
      method: "POST",
      middlewares: [authenticate("partner", ["session", "bearer"])],
    },
    // Partner customer group endpoints
    {
      matcher: "/partners/customer-groups",
      method: ["GET", "POST"],
      middlewares: [authenticate("partner", ["session", "bearer"])],
    },
    {
      matcher: "/partners/customer-groups/:id",
      method: ["GET", "POST", "DELETE"],
      middlewares: [authenticate("partner", ["session", "bearer"])],
    },
    {
      matcher: "/partners/customer-groups/:id/customers",
      method: "POST",
      middlewares: [authenticate("partner", ["session", "bearer"])],
    },
    // Partner Order endpoints
    {
      matcher: "/partners/orders",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/orders/:id",
      method: ["GET", "POST"],
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/orders/:id/cancel",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/orders/:id/fulfillments",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/orders/:id/fulfillments/:fulfillmentId/shipment",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/orders/:id/fulfillments/:fulfillmentId/cancel",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/orders/:id/fulfillments/:fulfillmentId/mark-as-delivered",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/orders/:id/fulfillments/:fulfillmentId/label",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/orders/:id/fulfillments/:fulfillmentId/tracking",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/orders/:id/fulfillments/:fulfillmentId/pickup",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/orders/:id/preview",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/orders/:id/changes",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/orders/:id/changes/:changeId",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/orders/:id/line-items",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/orders/:id/shipping-options",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/orders/:id/transfer",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/orders/:id/transfer/cancel",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/orders/:id/credit-lines",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/orders/changes/:orderChangeId",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    // Partner Return endpoints
    {
      matcher: "/partners/returns",
      method: ["GET", "POST"],
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/returns/:id",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/returns/:id/cancel",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/returns/:id/confirm",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/returns/:id/request",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/returns/:id/request/cancel",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/returns/:id/items",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/returns/:id/items/:actionId",
      method: ["POST", "DELETE"],
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/returns/:id/shipping",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/returns/:id/shipping/:actionId",
      method: ["POST", "DELETE"],
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/returns/:id/receive",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/returns/:id/receive/confirm",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/returns/:id/receive/cancel",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/returns/:id/receive-items",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/returns/:id/receive-items/:actionId",
      method: ["POST", "DELETE"],
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/returns/:id/dismiss-items",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/returns/:id/dismiss-items/:actionId",
      method: ["POST", "DELETE"],
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    // Partner Exchange endpoints
    {
      matcher: "/partners/exchanges",
      method: ["GET", "POST"],
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/exchanges/:id",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/exchanges/:id/cancel",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/exchanges/:id/inbound-items",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/exchanges/:id/inbound-items/:actionId",
      method: ["POST", "DELETE"],
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/exchanges/:id/inbound-shipping",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/exchanges/:id/inbound-shipping/:actionId",
      method: ["POST", "DELETE"],
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/exchanges/:id/outbound-items",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/exchanges/:id/outbound-items/:actionId",
      method: ["POST", "DELETE"],
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/exchanges/:id/outbound-shipping",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/exchanges/:id/outbound-shipping/:actionId",
      method: ["POST", "DELETE"],
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/exchanges/:id/request",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/exchanges/:id/request/cancel",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    // Partner Claim endpoints
    {
      matcher: "/partners/claims",
      method: ["GET", "POST"],
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/claims/:id",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/claims/:id/cancel",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/claims/:id/claim-items",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/claims/:id/claim-items/:actionId",
      method: ["POST", "DELETE"],
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/claims/:id/inbound-items",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/claims/:id/inbound-items/:actionId",
      method: ["POST", "DELETE"],
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/claims/:id/inbound-shipping",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/claims/:id/inbound-shipping/:actionId",
      method: ["POST", "DELETE"],
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/claims/:id/outbound-items",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/claims/:id/outbound-items/:actionId",
      method: ["POST", "DELETE"],
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/claims/:id/outbound-shipping",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/claims/:id/outbound-shipping/:actionId",
      method: ["POST", "DELETE"],
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/claims/:id/request",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/claims/:id/request/cancel",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    // Partner Order Edit endpoints
    {
      matcher: "/partners/order-edits",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/order-edits/:id",
      method: "DELETE",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/order-edits/:id/request",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/order-edits/:id/confirm",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/order-edits/:id/items",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/order-edits/:id/items/:itemId",
      method: ["POST", "DELETE"],
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    // Partner Payment endpoints
    {
      matcher: "/partners/payments/providers",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/payments/:id",
      method: "GET",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/payments/:id/capture",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/payments/:id/refund",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    // Partner Fulfillment endpoints (standalone)
    {
      matcher: "/partners/fulfillments",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/fulfillments/:id/cancel",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/fulfillments/:id/shipment",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    // Partner Payment Collection endpoints
    {
      matcher: "/partners/payment-collections",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/payment-collections/:id",
      method: "DELETE",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
    },
    {
      matcher: "/partners/payment-collections/:id/mark-as-paid",
      method: "POST",
      middlewares: [
        createCorsPartnerMiddleware(),
        authenticate("partner", ["session", "bearer"]),
      ],
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
    {
      matcher: "/admin/orders/:id/design",
      method: "GET",
      middlewares: [authenticate("user", ["session", "bearer"])],
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
