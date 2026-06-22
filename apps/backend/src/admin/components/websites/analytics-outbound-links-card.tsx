import { Container, Heading, Text, Badge, Skeleton } from "@medusajs/ui";
import { ArrowUpRightOnBox } from "@medusajs/icons";
import {
  useWebsiteAnalyticsOutbound,
  type OutboundLinkBucket,
} from "../../hooks/api/analytics";

/**
 * #569 S5b — Outbound Links card.
 *
 * Surfaces which external destinations visitors click through to, ranked by
 * click count, for the selected window. Built directly on the merged #569 S5a
 * backend (`GET /admin/websites/:id/analytics/outbound`, which groups the
 * `link_out` custom events by `metadata.href`) via the
 * `useWebsiteAnalyticsOutbound` hook.
 *
 * Single ranked-bar column, Medusa-token styled (follows dark mode), Skeleton
 * loading, reassuring empty state. Window (`days`) is driven by the parent
 * modal's existing time filter.
 */
export function AnalyticsOutboundLinksCard({
  websiteId,
  days,
}: {
  websiteId: string;
  days?: number;
}) {
  const { data, isLoading } = useWebsiteAnalyticsOutbound(websiteId, {
    days,
    limit: 10,
  });

  const breakdown = data?.outbound_links;
  const results = breakdown?.results ?? [];
  const totalEvents = breakdown?.total_events ?? 0;
  const max = results.reduce((m, b) => Math.max(m, b.count), 0) || 1;

  return (
    <Container className="p-0 overflow-hidden rounded-lg border border-ui-border-base bg-ui-bg-base">
      <div className="p-4 border-b border-ui-border-base flex items-center justify-between gap-x-2">
        <div className="flex items-center gap-x-2">
          <ArrowUpRightOnBox className="text-ui-fg-subtle" />
          <div>
            <Heading level="h3" className="text-sm font-medium">
              Outbound Links
            </Heading>
            <Text size="xsmall" className="text-ui-fg-subtle">
              External destinations visitors click through to
            </Text>
          </div>
        </div>
        {!isLoading && totalEvents > 0 && (
          <Text size="xsmall" className="text-ui-fg-subtle tabular-nums">
            {totalEvents.toLocaleString()} clicks
          </Text>
        )}
      </div>

      <div className="p-4">
        {isLoading ? (
          <div className="flex flex-col gap-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : results.length === 0 ? (
          <Text
            size="small"
            className="text-ui-fg-subtle py-6 text-center block"
          >
            No outbound link clicks in the selected window yet.
          </Text>
        ) : (
          <div className="flex flex-col gap-y-1">
            {results.map((b) => (
              <OutboundRow key={b.value} bucket={b} max={max} />
            ))}
          </div>
        )}
      </div>
    </Container>
  );
}

function OutboundRow({
  bucket,
  max,
}: {
  bucket: OutboundLinkBucket;
  max: number;
}) {
  return (
    <div
      className="group relative flex items-center justify-between overflow-hidden rounded-md px-2 py-1.5"
      title={`${bucket.value} — ${bucket.count.toLocaleString()} clicks`}
    >
      <div
        className="absolute inset-y-0 left-0 bg-ui-bg-component"
        style={{ width: `${Math.max((bucket.count / max) * 100, 1.5)}%` }}
        aria-hidden="true"
      />
      <Text
        size="small"
        className="relative z-10 truncate pr-3 font-mono text-ui-fg-base"
      >
        {bucket.value}
      </Text>
      <div className="relative z-10 flex shrink-0 items-center gap-x-3">
        <Text size="xsmall" className="text-ui-fg-subtle tabular-nums">
          {bucket.unique_visitors.toLocaleString()} vis
        </Text>
        <Badge size="2xsmall">{bucket.count.toLocaleString()}</Badge>
      </div>
    </div>
  );
}
