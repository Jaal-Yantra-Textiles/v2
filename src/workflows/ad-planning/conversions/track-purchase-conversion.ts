/**
 * Track Purchase Conversion Workflow
 *
 * Specialized workflow for e-commerce purchase conversions.
 * Triggered by order.placed events.
 */

import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { AD_PLANNING_MODULE } from "../../../modules/ad-planning";
import type AdPlanningService from "../../../modules/ad-planning/service";
import { Modules } from "@medusajs/framework/utils";

type TrackPurchaseConversionInput = {
  order_id: string;
  customer_id?: string;
  person_id?: string;
  session_id?: string;
  visitor_id?: string;
  website_id?: string;
};

/**
 * Step 1: Fetch order details
 */
const fetchOrderStep = createStep(
  "fetch-order",
  async (input: { order_id: string }, { container }) => {
    const orderService = container.resolve(Modules.ORDER) as any;

    const order = await orderService.retrieveOrder(input.order_id, {
      relations: ["items", "shipping_address"],
    });

    if (!order) {
      throw new Error(`Order ${input.order_id} not found`);
    }

    return new StepResponse({
      id: order.id,
      total: order.total,
      currency: order.currency_code,
      customer_id: order.customer_id,
      email: order.email,
      items: order.items?.map((item: any) => ({
        product_id: item.product_id,
        variant_id: item.variant_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
      })),
    });
  }
);

/**
 * Step 2: Find attribution from session or customer
 */
const findAttributionStep = createStep(
  "find-attribution",
  async (
    input: {
      session_id?: string;
      customer_id?: string;
      person_id?: string;
    },
    { container }
  ) => {
    const adPlanningService: AdPlanningService = container.resolve(AD_PLANNING_MODULE);

    // Try session-based attribution first
    if (input.session_id) {
      const sessionAttr = await adPlanningService.listCampaignAttributions({
        analytics_session_id: input.session_id,
        is_resolved: true,
      });

      if (sessionAttr.length > 0) {
        return new StepResponse({
          ad_campaign_id: sessionAttr[0].ad_campaign_id,
          ad_set_id: sessionAttr[0].ad_set_id,
          ad_id: sessionAttr[0].ad_id,
          platform: sessionAttr[0].platform,
          utm_source: sessionAttr[0].utm_source,
          utm_medium: sessionAttr[0].utm_medium,
          utm_campaign: sessionAttr[0].utm_campaign,
          attribution_method: "session",
        });
      }
    }

    // Try customer/person based (last-touch attribution)
    if (input.person_id || input.customer_id) {
      const personAttr = await adPlanningService.listCampaignAttributions({
        is_resolved: true,
      });

      // Find most recent attribution for this person/visitor
      const sorted = personAttr
        .filter((a: any) => a.visitor_id)
        .sort((a: any, b: any) =>
          new Date(b.attributed_at).getTime() - new Date(a.attributed_at).getTime()
        );

      if (sorted.length > 0) {
        return new StepResponse({
          ad_campaign_id: sorted[0].ad_campaign_id,
          ad_set_id: sorted[0].ad_set_id,
          ad_id: sorted[0].ad_id,
          platform: sorted[0].platform,
          utm_source: sorted[0].utm_source,
          utm_medium: sorted[0].utm_medium,
          utm_campaign: sorted[0].utm_campaign,
          attribution_method: "last_touch",
        });
      }
    }

    return new StepResponse({
      ad_campaign_id: null,
      ad_set_id: null,
      ad_id: null,
      platform: "generic" as const,
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
      attribution_method: "unattributed",
    });
  }
);

/**
 * Step 3: Create purchase conversion
 */
const createPurchaseConversionStep = createStep(
  "create-purchase-conversion",
  async (
    input: {
      order: {
        id: string;
        total: number;
        currency: string;
        customer_id?: string;
        items?: Array<{
          product_id: string;
          variant_id: string;
          quantity: number;
          unit_price: number;
        }>;
      };
      attribution: {
        ad_campaign_id: string | null;
        ad_set_id: string | null;
        ad_id: string | null;
        platform: "meta" | "google" | "generic";
        utm_source?: string | null;
        utm_medium?: string | null;
        utm_campaign?: string | null;
        attribution_method: string;
      };
      session_id?: string;
      visitor_id?: string;
      website_id?: string;
      person_id?: string;
    },
    { container }
  ) => {
    const adPlanningService: AdPlanningService = container.resolve(AD_PLANNING_MODULE);

    const [conversion] = await adPlanningService.createConversions([
      {
        conversion_type: "purchase",
        ad_campaign_id: input.attribution.ad_campaign_id,
        ad_set_id: input.attribution.ad_set_id,
        ad_id: input.attribution.ad_id,
        platform: input.attribution.platform,
        visitor_id: input.visitor_id,
        analytics_session_id: input.session_id,
        website_id: input.website_id,
        conversion_value: input.order.total,
        currency: input.order.currency?.toUpperCase() || "INR",
        order_id: input.order.id,
        person_id: input.person_id,
        utm_source: input.attribution.utm_source,
        utm_medium: input.attribution.utm_medium,
        utm_campaign: input.attribution.utm_campaign,
        metadata: {
          attribution_method: input.attribution.attribution_method,
          customer_id: input.order.customer_id,
          item_count: input.order.items?.length || 0,
          items: input.order.items?.slice(0, 10), // Store first 10 items
        },
        converted_at: new Date(),
      },
    ]);

    return new StepResponse(conversion, conversion.id);
  },
  async (conversionId, { container }) => {
    if (conversionId) {
      const adPlanningService: AdPlanningService = container.resolve(AD_PLANNING_MODULE);
      await adPlanningService.deleteConversions([conversionId]);
    }
  }
);

/**
 * Step 4: Update customer lifetime value
 */
const updateCustomerValueStep = createStep(
  "update-customer-value",
  async (
    input: {
      person_id?: string;
      order_total: number;
      currency: string;
    },
    { container }
  ) => {
    if (!input.person_id) {
      return new StepResponse({ updated: false });
    }

    const adPlanningService: AdPlanningService = container.resolve(AD_PLANNING_MODULE);

    // Check for existing CLV score
    const existing = await adPlanningService.listCustomerScores({
      person_id: input.person_id,
      score_type: "clv",
    });

    if (existing.length > 0) {
      // Update existing CLV
      const newValue = (Number(existing[0].score_value) || 0) + input.order_total;
      const existingMetadata = (existing[0].metadata || {}) as Record<string, any>;
      await adPlanningService.updateCustomerScores({
        id: existing[0].id,
        score_value: newValue,
        metadata: {
          ...existingMetadata,
          last_purchase_at: new Date().toISOString(),
          total_purchases: (existingMetadata.total_purchases || 0) + 1,
        },
        calculated_at: new Date(),
      });
    } else {
      // Create new CLV record
      await adPlanningService.createCustomerScores([
        {
          person_id: input.person_id,
          score_type: "clv",
          score_value: input.order_total,
          metadata: {
            first_purchase_at: new Date().toISOString(),
            last_purchase_at: new Date().toISOString(),
            total_purchases: 1,
            currency: input.currency,
          },
          calculated_at: new Date(),
        },
      ]);
    }

    return new StepResponse({ updated: true });
  }
);

/**
 * Step 5: Add to customer journey
 */
const addPurchaseJourneyStep = createStep(
  "add-purchase-journey",
  async (
    input: {
      person_id?: string;
      order_id: string;
      order_total: number;
      website_id?: string;
      session_id?: string;
    },
    { container }
  ) => {
    if (!input.person_id) {
      return new StepResponse({ added: false });
    }

    const adPlanningService: AdPlanningService = container.resolve(AD_PLANNING_MODULE);

    await adPlanningService.createCustomerJourneys([
      {
        person_id: input.person_id,
        website_id: input.website_id,
        event_type: "purchase" as const,
        stage: "conversion" as const,
        event_data: {
          order_id: input.order_id,
          order_total: input.order_total,
          session_id: input.session_id,
        },
        occurred_at: new Date(),
      },
    ]);

    return new StepResponse({ added: true });
  }
);

/**
 * Main workflow: Track purchase conversion
 */
export const trackPurchaseConversionWorkflow = createWorkflow(
  "track-purchase-conversion",
  (input: TrackPurchaseConversionInput) => {
    const order = fetchOrderStep({ order_id: input.order_id });

    const attribution = findAttributionStep({
      session_id: input.session_id,
      customer_id: input.customer_id,
      person_id: input.person_id,
    });

    const conversion = createPurchaseConversionStep({
      order,
      attribution,
      session_id: input.session_id,
      visitor_id: input.visitor_id,
      website_id: input.website_id,
      person_id: input.person_id,
    });

    updateCustomerValueStep({
      person_id: input.person_id,
      order_total: order.total,
      currency: order.currency,
    });

    addPurchaseJourneyStep({
      person_id: input.person_id,
      order_id: input.order_id,
      order_total: order.total,
      website_id: input.website_id,
      session_id: input.session_id,
    });

    return new WorkflowResponse({
      conversion,
      order_id: input.order_id,
      attributed: attribution.ad_campaign_id !== null,
      attribution_method: attribution.attribution_method,
    });
  }
);

export default trackPurchaseConversionWorkflow;
