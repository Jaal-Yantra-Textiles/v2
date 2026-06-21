import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { WEBSITE_MODULE } from "../../modules/website";
import { getWebsiteAnalyticsOverviewWorkflow } from "./get-website-analytics-overview";
import { getAnalyticsBreakdownWorkflow } from "./reports/get-analytics-breakdown";
import {
  breakdownToItems,
  buildDigestKpis,
  buildDigestSuggestions,
  resolvePeriodRange,
  type DigestPeriod,
  type DigestThresholds,
  type PartnerStorefrontDigest,
} from "./partner-digest-lib";

/**
 * Compute a per-partner storefront analytics digest (#581 S1).
 *
 * Given a partner id + period it resolves the partner's website, runs the
 * #569 overview for the current AND previous windows (for deltas), pulls the
 * #559 breakdowns the digest surfaces, and assembles a digest JSON with
 * rule-based suggestions (pure helpers in `partner-digest-lib.ts`).
 *
 * Per-partner scoping: a partner's analytics = their website's events. The
 * website is resolved from the partner's `website_id` column (metadata
 * fallback), then `storefront_domain` — mirroring
 * `api/partners/storefront/helpers.ts#getPartnerWebsite`.
 */
export type GetPartnerStorefrontDigestInput = {
  partner_id: string;
  period?: DigestPeriod;
  thresholds?: Partial<DigestThresholds>;
  /** ISO timestamp; injectable for deterministic runs. Defaults to now. */
  now?: string;
};

const resolvePartnerWebsiteId = async (
  partnerId: string,
  container: any
): Promise<{ websiteId: string | null; partner: any }> => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: "partners",
    filters: { id: partnerId },
    fields: ["id", "website_id", "storefront_domain", "metadata"],
  });
  const partner = (data || [])[0] || null;
  if (!partner) {
    return { websiteId: null, partner: null };
  }

  const websiteService: any = container.resolve(WEBSITE_MODULE);

  // 1. Direct id (column or metadata fallback).
  const directId = partner.website_id || partner.metadata?.website_id;
  if (directId) {
    try {
      const w = await websiteService.retrieveWebsite(directId);
      if (w) return { websiteId: w.id, partner };
    } catch {
      // stale id — fall through to domain lookup
    }
  }

  // 2. Fallback by storefront domain.
  const domain =
    partner.storefront_domain || partner.metadata?.storefront_domain;
  if (domain) {
    const [websites] = await websiteService.listAndCountWebsites(
      { domain },
      { take: 1 }
    );
    if (websites?.[0]) return { websiteId: websites[0].id, partner };
  }

  return { websiteId: null, partner };
};

export const getPartnerStorefrontDigestStep = createStep(
  "get-partner-storefront-digest-step",
  async (input: GetPartnerStorefrontDigestInput, { container }) => {
    const now = input.now ? new Date(input.now) : new Date();
    const ranges = resolvePeriodRange(input.period ?? "last_7_days", now);

    const { websiteId, partner } = await resolvePartnerWebsiteId(
      input.partner_id,
      container
    );

    // No storefront yet → empty digest (no suggestions). Never throws so the
    // visual flow can skip un-provisioned partners gracefully.
    if (!websiteId) {
      const empty: PartnerStorefrontDigest = {
        partner_id: input.partner_id,
        website: null,
        period: {
          label: ranges.label,
          days: ranges.days,
          current: ranges.current,
          previous: ranges.previous,
        },
        kpis: buildDigestKpis(null, null),
        breakdowns: { top_pages: [], referrers: [], devices: [], countries: [] },
        not_found_count: 0,
        suggestions: [],
      };
      return new StepResponse(empty);
    }

    const curStart = new Date(ranges.current.start);
    const curEnd = new Date(ranges.current.end);

    // Overview for both windows (for deltas).
    const { result: currentOverview }: any =
      await getWebsiteAnalyticsOverviewWorkflow(container).run({
        input: {
          website_id: websiteId,
          from: ranges.current.start,
          to: ranges.current.end,
        },
      });
    const { result: previousOverview }: any =
      await getWebsiteAnalyticsOverviewWorkflow(container).run({
        input: {
          website_id: websiteId,
          from: ranges.previous.start,
          to: ranges.previous.end,
        },
      });

    const runBreakdown = (dimension: any, filters?: Record<string, string>) =>
      getAnalyticsBreakdownWorkflow(container)
        .run({
          input: {
            website_id: websiteId,
            dimension,
            start_date: curStart,
            end_date: curEnd,
            ...(filters ? { filters } : {}),
            limit: 5,
          },
        })
        .then((r: any) => r.result);

    const [topPages, referrers, devices, countries, notFound] = await Promise.all([
      runBreakdown("pathname"),
      runBreakdown("referrer_source"),
      runBreakdown("device_type"),
      runBreakdown("country"),
      runBreakdown("is_404", { is_404: "true" }),
    ]);

    const notFoundCount = Number((notFound as any)?.total_events ?? 0) || 0;

    const breakdowns = {
      top_pages: breakdownToItems(topPages as any),
      referrers: breakdownToItems(referrers as any),
      devices: breakdownToItems(devices as any),
      countries: breakdownToItems(countries as any),
    };

    const kpis = buildDigestKpis(
      (currentOverview as any)?.stats,
      (previousOverview as any)?.stats
    );

    const websiteOut = (currentOverview as any)?.website;

    const digest: PartnerStorefrontDigest = {
      partner_id: input.partner_id,
      website: websiteOut
        ? { id: websiteOut.id, domain: websiteOut.domain, name: websiteOut.name }
        : { id: websiteId, domain: partner?.storefront_domain ?? "", name: null },
      period: {
        label: ranges.label,
        days: ranges.days,
        current: ranges.current,
        previous: ranges.previous,
      },
      kpis,
      breakdowns,
      not_found_count: notFoundCount,
      suggestions: [],
    };

    digest.suggestions = buildDigestSuggestions(
      digest,
      { ...input.thresholds } as DigestThresholds
    );

    return new StepResponse(digest);
  }
);

export const getPartnerStorefrontDigestWorkflow = createWorkflow(
  "get-partner-storefront-digest",
  (input: GetPartnerStorefrontDigestInput) => {
    const digest = getPartnerStorefrontDigestStep(input);
    return new WorkflowResponse(digest);
  }
);
