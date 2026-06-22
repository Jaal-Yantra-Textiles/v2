import { Container, Heading, Text, Badge, Skeleton } from "@medusajs/ui";
import { ExclamationCircle } from "@medusajs/icons";
import {
  useAnalyticsBreakdown,
} from "../../hooks/api/analytics";

/**
 * #569 S4 — Top 404s (broken-links) card.
 *
 * Surfaces the paths that returned a 404 in the selected window, ranked by hits.
 * Built directly on the merged #559 breakdown backend: a single
 * `useAnalyticsBreakdown` call with `dimension=pathname` + the composable
 * equality filter `is_404=true` (the server normalizes the boolean — see
 * breakdown-lib.normalizeFieldValue). Medusa-token styled (follows dark mode),
 * Skeleton loading, reassuring empty state.
 *
 * Window (`days`) is driven by the parent modal's existing time filter.
 */
export function AnalyticsTop404Card({
  websiteId,
  days,
}: {
  websiteId: string;
  days?: number;
}) {
  const { data, isLoading } = useAnalyticsBreakdown({
    website_id: websiteId,
    dimension: "pathname",
    days,
    limit: 10,
    filters: { is_404: true },
  });

  const breakdown = data?.breakdown;
  const results = breakdown?.results ?? [];
  const totalHits = breakdown?.total_events ?? 0;
  const max = results.reduce((m, b) => Math.max(m, b.count), 0) || 1;

  return (
    <Container className="p-0 overflow-hidden rounded-lg border border-ui-border-base bg-ui-bg-base">
      <div className="p-4 border-b border-ui-border-base flex items-center justify-between gap-x-2">
        <div className="flex items-center gap-x-2">
          <ExclamationCircle className="text-ui-fg-subtle" />
          <Heading level="h3" className="text-sm font-medium">
            Broken Links (404s)
          </Heading>
        </div>
        {!isLoading && totalHits > 0 && (
          <Text size="xsmall" className="text-ui-fg-subtle tabular-nums">
            {totalHits.toLocaleString()} hits
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
            No 404s in the selected window — every tracked link resolved. 🎉
          </Text>
        ) : (
          <div className="flex flex-col gap-y-1">
            {results.map((b) => (
              <div
                key={b.value}
                className="group relative flex items-center justify-between overflow-hidden rounded-md px-2 py-1.5"
                title={`${b.value} — ${b.count.toLocaleString()} hits`}
              >
                <div
                  className="absolute inset-y-0 left-0 bg-ui-tag-red-bg"
                  style={{ width: `${Math.max((b.count / max) * 100, 1.5)}%` }}
                  aria-hidden="true"
                />
                <Text
                  size="small"
                  className="relative z-10 truncate pr-3 font-mono text-ui-fg-base"
                >
                  {b.value}
                </Text>
                <div className="relative z-10 flex shrink-0 items-center gap-x-3">
                  <Text size="xsmall" className="text-ui-fg-subtle tabular-nums">
                    {b.unique_visitors.toLocaleString()} vis
                  </Text>
                  <Badge size="2xsmall" color="red">
                    {b.count.toLocaleString()}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Container>
  );
}
