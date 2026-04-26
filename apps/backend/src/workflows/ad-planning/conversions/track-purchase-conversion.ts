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
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { PERSON_MODULE } from "../../../modules/person";

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
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY);

    // Use query.graph so computed totals (from order_summary) are populated.
    // orderService.retrieveOrder() does NOT populate `total` — it only returns raw entity fields.
    const { data: [order] } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "total",
        "subtotal",
        "tax_total",
        "shipping_total",
        "currency_code",
        "customer_id",
        "email",
        "items.*",
      ],
      filters: { id: input.order_id },
    });

    if (!order) {
      throw new Error(`Order ${input.order_id} not found`);
    }

    return new StepResponse({
      id: order.id,
      total: Number(order.total) || 0,
      currency: order.currency_code,
      customer_id: order.customer_id,
      email: order.email,
      items: (order.items as any[])?.map((item: any) => ({
        product_id: item.product_id,
        variant_id: item.variant_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
      })),
    });
  }
);

/**
 * Step 2: Resolve person_id from order email
 */
const resolvePersonStep = createStep(
  "resolve-person",
  async (
    input: { email?: string; person_id?: string },
    { container }
  ) => {
    // If person_id already provided, use it
    if (input.person_id) {
      return new StepResponse({ person_id: input.person_id });
    }

    // Try to resolve person from order email
    if (input.email) {
      try {
        const personService = container.resolve(PERSON_MODULE) as any;
        const persons = await personService.listPeople({ email: input.email });
        if (persons?.length > 0) {
          return new StepResponse({ person_id: persons[0].id });
        }
      } catch {
        // Person module lookup failed — non-fatal
      }
    }

    return new StepResponse({ person_id: null as string | null });
  }
);

/**
 * Step 3: Find attribution from session or customer
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

    // Try customer/person based (last-touch attribution).
    //
    // CRITICAL: CampaignAttribution has no person_id column — only visitor_id.
    // Previously this code fetched ALL resolved attributions system-wide and
    // assigned the most recent one to the current order, leaking attribution
    // across unrelated customers.
    //
    // Correct approach: look up visitor_ids that belong to this person via
    // their historical Conversion records (which link person_id → visitor_id),
    // then scope the attribution query to only those visitor_ids.
    if (input.person_id) {
      // Find all visitor_ids historically associated with this person.
      const personConversions = await adPlanningService.listConversions(
        { person_id: input.person_id },
        { take: 100 }
      );

      const visitorIds = Array.from(
        new Set(
          personConversions
            .map((c: any) => c.visitor_id)
            .filter((v: string) => !!v)
        )
      );

      if (visitorIds.length > 0) {
        const personAttr = await adPlanningService.listCampaignAttributions(
          {
            is_resolved: true,
            visitor_id: visitorIds,
          },
          { take: 50 }
        );

        // Find most recent attribution belonging to this person's visitors
        const sorted = personAttr.sort(
          (a: any, b: any) =>
            new Date(b.attributed_at).getTime() -
            new Date(a.attributed_at).getTime()
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
        platform: "meta" | "google" | "generic" | "direct";
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

    // Generate a fallback visitor_id if none provided (e.g. redirect-based payments like PayU)
    const visitorId = input.visitor_id || `anon_${input.order.id}`;

    const [conversion] = await adPlanningService.createConversions([
      {
        conversion_type: "purchase",
        ad_campaign_id: input.attribution.ad_campaign_id,
        ad_set_id: input.attribution.ad_set_id,
        ad_id: input.attribution.ad_id,
        platform: input.attribution.platform,
        visitor_id: visitorId,
        analytics_session_id: input.session_id,
        website_id: input.website_id,
        conversion_value: input.order.total,
        // Prefer the order's currency (populated from Medusa order_summary).
        // Fall back to null so no garbage "INR" label leaks onto EUR/USD
        // stores — the UI and aggregation layer handle null by using the
        // store default.
        currency: input.order.currency?.toUpperCase() || null,
        order_id: input.order.id,
        person_id: input.person_id,
        utm_source: input.attribution.utm_source,
        utm_medium: input.attribution.utm_medium,
        utm_campaign: input.attribution.utm_campaign,
        metadata: {
          attribution_method: input.attribution.attribution_method,
          customer_id: input.order.customer_id,
          item_count: input.order.items?.length || 0,
          items: input.order.items?.slice(0, 10),
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
 * Step 4: Recalculate customer lifetime value (full prediction, not just increment)
 */
const recalculateCLVStep = createStep(
  "recalculate-clv",
  async (
    input: {
      person_id?: string | null;
    },
    { container }
  ) => {
    if (!input.person_id) {
      return new StepResponse({ updated: false });
    }

    try {
      // Import and run the full CLV workflow inline as a step
      // to avoid circular workflow dependencies
      const adPlanningService: AdPlanningService = container.resolve(AD_PLANNING_MODULE);

      // Get all purchases for this person
      const purchases = await adPlanningService.listConversions({
        person_id: input.person_id,
        conversion_type: "purchase",
      });

      const sortedPurchases = purchases.sort(
        (a: any, b: any) => new Date(a.converted_at).getTime() - new Date(b.converted_at).getTime()
      );

      const purchaseCount = sortedPurchases.length;
      const totalRevenue = sortedPurchases.reduce(
        (sum: number, p: any) => sum + (Number(p.conversion_value) || 0), 0
      );

      if (purchaseCount === 0) {
        return new StepResponse({ updated: false });
      }

      const averageOrderValue = totalRevenue / purchaseCount;

      // Calculate purchase frequency
      const firstPurchase = sortedPurchases[0];
      const lifespanDays = Math.max(1, Math.floor(
        (Date.now() - new Date(firstPurchase.converted_at).getTime()) / (24 * 60 * 60 * 1000)
      ));
      const lifespanMonths = Math.max(1, lifespanDays / 30);

      let monthlyFrequency: number;
      let avgDaysBetween = 0;

      if (purchaseCount <= 1) {
        monthlyFrequency = 1 / 3;
      } else {
        monthlyFrequency = purchaseCount / lifespanMonths;
        const daysBetween: number[] = [];
        for (let i = 1; i < sortedPurchases.length; i++) {
          daysBetween.push(Math.floor(
            (new Date(sortedPurchases[i].converted_at).getTime() -
              new Date(sortedPurchases[i - 1].converted_at).getTime()) / (24 * 60 * 60 * 1000)
          ));
        }
        avgDaysBetween = daysBetween.reduce((a, b) => a + b, 0) / daysBetween.length;
      }

      // Estimate lifespan
      let adjustedLifespan = 24;
      if (purchaseCount >= 2 && avgDaysBetween > 0 && avgDaysBetween < 90) {
        adjustedLifespan = Math.min(36, 24 * 1.5);
      } else if (avgDaysBetween > 180) {
        adjustedLifespan = Math.max(6, 24 * 0.5);
      } else if (purchaseCount <= 1) {
        adjustedLifespan = 12;
      }

      const predictedCLV = Math.round(averageOrderValue * monthlyFrequency * adjustedLifespan * 100) / 100;
      const remainingCLV = Math.max(0, predictedCLV - totalRevenue);

      // Determine tier
      let tier: string;
      if (predictedCLV >= 50000) tier = "platinum";
      else if (predictedCLV >= 20000) tier = "gold";
      else if (predictedCLV >= 5000) tier = "silver";
      else tier = "bronze";

      // Upsert CLV score
      const existing = await adPlanningService.listCustomerScores({
        person_id: input.person_id,
        score_type: "clv",
      });

      const scoreData = {
        predicted_clv: predictedCLV,
        remaining_clv: remainingCLV,
        realized_clv: totalRevenue,
        tier,
        metrics: {
          average_order_value: Math.round(averageOrderValue * 100) / 100,
          monthly_frequency: Math.round(monthlyFrequency * 100) / 100,
          purchase_count: purchaseCount,
        },
        calculated_at: new Date().toISOString(),
      };

      if (existing.length > 0) {
        const existingMetadata = (existing[0].metadata as Record<string, any>) || {};
        const history = existingMetadata.history || [];
        history.push({
          predicted_clv: predictedCLV,
          realized_clv: totalRevenue,
          date: new Date().toISOString(),
        });

        await adPlanningService.updateCustomerScores({
          id: existing[0].id,
          score_value: predictedCLV,
          metadata: {
            ...scoreData,
            history: history.slice(-12),
            previous_predicted: existingMetadata.predicted_clv,
          },
          calculated_at: new Date(),
        });
      } else {
        await adPlanningService.createCustomerScores([{
          person_id: input.person_id,
          score_type: "clv",
          score_value: predictedCLV,
          metadata: {
            ...scoreData,
            history: [{ predicted_clv: predictedCLV, realized_clv: totalRevenue, date: new Date().toISOString() }],
          },
          calculated_at: new Date(),
        }]);
      }

      return new StepResponse({ updated: true, predicted_clv: predictedCLV, tier });
    } catch (error) {
      console.error("[AdPlanning] CLV recalculation failed:", error);
      return new StepResponse({ updated: false });
    }
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
 * Step 6: Recalculate engagement score after purchase
 */
const recalculateEngagementAfterPurchaseStep = createStep(
  "recalculate-engagement-after-purchase",
  async (input: { person_id?: string | null }, { container }) => {
    if (!input.person_id) return new StepResponse({ updated: false });

    try {
      const adPlanningService: AdPlanningService = container.resolve(AD_PLANNING_MODULE);

      const conversions = await adPlanningService.listConversions({ person_id: input.person_id });
      const sentiments = await adPlanningService.listSentimentAnalyses({ person_id: input.person_id });
      const journeyEvents = await adPlanningService.listCustomerJourneys({ person_id: input.person_id });

      const WEIGHTS: Record<string, number> = {
        page_view: 1, session: 5, product_view: 3, add_to_cart: 10,
        begin_checkout: 15, purchase: 25, form_submit: 15, feedback: 20,
        social_share: 8, email_open: 2, email_click: 5,
      };

      const now = Date.now();
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
      let totalScore = 0;

      const score = (type: string, date: Date, value?: number) => {
        const age = now - date.getTime();
        let w = WEIGHTS[type] || 1;
        if (age < thirtyDaysMs) w *= 1.0;
        else if (age < ninetyDaysMs) w *= 0.5;
        else w *= 0.25;
        if (type === "purchase" && value && value > 0) w += Math.log10(value + 1) * 2;
        totalScore += w;
      };

      for (const c of conversions) score(c.conversion_type, new Date(c.converted_at), Number(c.conversion_value) || 0);
      for (const s of sentiments) score("feedback", new Date(s.analyzed_at));
      for (const e of journeyEvents) score(e.event_type, new Date(e.occurred_at));

      const normalized = Math.min(100, Math.round(totalScore / 5));
      const level = normalized >= 70 ? "high" : normalized >= 40 ? "medium" : normalized > 0 ? "low" : "inactive";

      const existing = await adPlanningService.listCustomerScores({
        person_id: input.person_id, score_type: "engagement",
      });

      if (existing.length > 0) {
        const meta = (existing[0].metadata as Record<string, any>) || {};
        const history = meta.score_history || [];
        history.push({ score: normalized, date: new Date().toISOString() });
        await adPlanningService.updateCustomerScores({
          id: existing[0].id, score_value: normalized,
          metadata: { level, score_history: history.slice(-30), previous_score: existing[0].score_value },
          calculated_at: new Date(),
        });
      } else {
        await adPlanningService.createCustomerScores([{
          person_id: input.person_id, score_type: "engagement" as const,
          score_value: normalized,
          metadata: { level, score_history: [{ score: normalized, date: new Date().toISOString() }] },
          calculated_at: new Date(),
        }]);
      }

      return new StepResponse({ updated: true, score: normalized });
    } catch (error) {
      console.error("[AdPlanning] Post-purchase engagement recalc failed:", error);
      return new StepResponse({ updated: false });
    }
  }
);

/**
 * Step 7: Recalculate churn risk after purchase (purchase resets inactivity signals)
 */
const recalculateChurnRiskAfterPurchaseStep = createStep(
  "recalculate-churn-after-purchase",
  async (input: { person_id?: string | null }, { container }) => {
    if (!input.person_id) return new StepResponse({ updated: false });

    try {
      const adPlanningService: AdPlanningService = container.resolve(AD_PLANNING_MODULE);
      const now = new Date();

      const journeyEvents = await adPlanningService.listCustomerJourneys({ person_id: input.person_id });
      const conversions = await adPlanningService.listConversions({ person_id: input.person_id });
      const sentiments = await adPlanningService.listSentimentAnalyses({ person_id: input.person_id });
      const scores = await adPlanningService.listCustomerScores({ person_id: input.person_id });

      // Days since last activity
      const lastActivity = journeyEvents.length > 0
        ? new Date(Math.max(...journeyEvents.map((e: any) => new Date(e.occurred_at).getTime())))
        : null;
      const daysSinceActivity = lastActivity
        ? Math.floor((now.getTime() - lastActivity.getTime()) / (24 * 60 * 60 * 1000))
        : 365;

      // Days since last purchase
      const lastPurchase = conversions
        .filter((c: any) => c.conversion_type === "purchase")
        .sort((a: any, b: any) => new Date(b.converted_at).getTime() - new Date(a.converted_at).getTime())[0];
      const daysSincePurchase = lastPurchase
        ? Math.floor((now.getTime() - new Date(lastPurchase.converted_at).getTime()) / (24 * 60 * 60 * 1000))
        : 365;

      // Engagement decline
      const engagementScore = scores.find((s: any) => s.score_type === "engagement");
      const engagementMeta = engagementScore?.metadata as Record<string, any> | null;
      const engHistory = engagementMeta?.score_history || [];
      let engagementDecline = 0;
      if (engHistory.length >= 2) {
        const recent = engHistory.slice(-3).map((h: any) => h.score);
        const earlier = engHistory.slice(0, 3).map((h: any) => h.score);
        const recentAvg = recent.reduce((a: number, b: number) => a + b, 0) / recent.length;
        const earlierAvg = earlier.reduce((a: number, b: number) => a + b, 0) / earlier.length;
        engagementDecline = earlierAvg > 0 ? ((earlierAvg - recentAvg) / earlierAvg) * 100 : 0;
      }

      // Negative sentiment ratio — count both "negative" and "very_negative"
      // (with the latter weighted 1.5× to give the strongest signal more weight).
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const recentSentiments = sentiments.filter((s: any) => new Date(s.analyzed_at) >= thirtyDaysAgo);
      const negWeight = recentSentiments.reduce((acc: number, s: any) => {
        if (s.sentiment_label === "very_negative") return acc + 1.5;
        if (s.sentiment_label === "negative") return acc + 1;
        return acc;
      }, 0);
      const negRatio = recentSentiments.length > 0
        ? Math.min(1, negWeight / recentSentiments.length)
        : 0;

      // Weighted risk score (weights must sum to 1.0)
      const activityRisk = Math.min(1, daysSinceActivity / 90) * 0.35;
      const purchaseRisk = Math.min(1, daysSincePurchase / 180) * 0.30;
      const engRisk = Math.min(1, Math.max(0, engagementDecline) / 100) * 0.20;
      const sentRisk = negRatio * 0.15;

      let riskScore = activityRisk + purchaseRisk + engRisk + sentRisk;

      // Value adjustments
      const totalPurchases = conversions.filter((c: any) => c.conversion_type === "purchase").length;
      if (totalPurchases > 5) riskScore -= 0.05;
      else if (totalPurchases === 0) riskScore += 0.1;

      riskScore = Math.max(0, Math.min(1, riskScore));
      const normalized = Math.round(riskScore * 100);

      const riskLevel = normalized >= 75 ? "critical" : normalized >= 50 ? "high" : normalized >= 25 ? "medium" : "low";

      // Upsert
      const existing = await adPlanningService.listCustomerScores({
        person_id: input.person_id, score_type: "churn_risk",
      });

      if (existing.length > 0) {
        const meta = (existing[0].metadata as Record<string, any>) || {};
        const history = meta.history || [];
        history.push({ score: normalized, level: riskLevel, date: new Date().toISOString() });
        await adPlanningService.updateCustomerScores({
          id: existing[0].id, score_value: normalized,
          metadata: { risk_level: riskLevel, history: history.slice(-30), previous_score: existing[0].score_value },
          calculated_at: new Date(),
        });
      } else {
        await adPlanningService.createCustomerScores([{
          person_id: input.person_id, score_type: "churn_risk",
          score_value: normalized,
          metadata: { risk_level: riskLevel, history: [{ score: normalized, level: riskLevel, date: new Date().toISOString() }] },
          calculated_at: new Date(),
        }]);
      }

      return new StepResponse({ updated: true, risk_score: normalized, risk_level: riskLevel });
    } catch (error) {
      console.error("[AdPlanning] Post-purchase churn risk recalc failed:", error);
      return new StepResponse({ updated: false });
    }
  }
);

/**
 * Step 8: Rebuild active auto-update segments that may be affected by score changes
 */
const rebuildAutoSegmentsStep = createStep(
  "rebuild-auto-segments",
  async (input: { person_id?: string | null }, { container }) => {
    if (!input.person_id) return new StepResponse({ rebuilt: 0 });

    try {
      const adPlanningService: AdPlanningService = container.resolve(AD_PLANNING_MODULE);

      // Find active segments with auto_update enabled
      const segments = await adPlanningService.listCustomerSegments({
        is_active: true,
        auto_update: true,
      });

      if (segments.length === 0) return new StepResponse({ rebuilt: 0 });

      // Import build workflow dynamically to avoid circular deps
      const { buildSegmentWorkflow } = await import("../segments/build-segment.js");

      let rebuilt = 0;
      for (const segment of segments) {
        try {
          await buildSegmentWorkflow(container).run({
            input: { segment_id: segment.id },
          });
          rebuilt++;
        } catch (error) {
          console.error(`[AdPlanning] Failed to rebuild segment ${segment.id}:`, error);
        }
      }

      return new StepResponse({ rebuilt });
    } catch (error) {
      console.error("[AdPlanning] Segment auto-rebuild failed:", error);
      return new StepResponse({ rebuilt: 0 });
    }
  }
);

/**
 * Main workflow: Track purchase conversion
 */
export const trackPurchaseConversionWorkflow = createWorkflow(
  "track-purchase-conversion",
  (input: TrackPurchaseConversionInput) => {
    const order = fetchOrderStep({ order_id: input.order_id });

    // Resolve person_id from input or order email
    const personResolution = resolvePersonStep({
      email: order.email,
      person_id: input.person_id,
    });

    const attribution = findAttributionStep({
      session_id: input.session_id,
      customer_id: input.customer_id,
      person_id: personResolution.person_id,
    });

    const conversion = createPurchaseConversionStep({
      order,
      attribution,
      session_id: input.session_id,
      visitor_id: input.visitor_id,
      website_id: input.website_id,
      person_id: personResolution.person_id,
    });

    recalculateCLVStep({
      person_id: personResolution.person_id,
    });

    addPurchaseJourneyStep({
      person_id: personResolution.person_id,
      order_id: input.order_id,
      order_total: order.total,
      website_id: input.website_id,
      session_id: input.session_id,
    });

    // Recalculate engagement and churn risk after purchase
    recalculateEngagementAfterPurchaseStep({
      person_id: personResolution.person_id,
    });

    recalculateChurnRiskAfterPurchaseStep({
      person_id: personResolution.person_id,
    });

    // Rebuild auto-update segments with refreshed scores
    rebuildAutoSegmentsStep({
      person_id: personResolution.person_id,
    });

    return new WorkflowResponse({
      conversion,
      order_id: input.order_id,
      person_id: personResolution.person_id,
      attributed: attribution.ad_campaign_id !== null,
      attribution_method: attribution.attribution_method,
    });
  }
);

export default trackPurchaseConversionWorkflow;
