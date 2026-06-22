import { Container, Heading, Text, Badge, Skeleton } from "@medusajs/ui";
import { ArrowDownLeftMini, ArrowUpRightMini } from "@medusajs/icons";
import {
  useWebsiteAnalyticsPages,
  type SessionPageBreakdown,
} from "../../hooks/api/analytics";

/**
 * #569 S2b — Entry & Exit pages card.
 *
 * Surfaces where visitors land (`entry_page`) and where they leave
 * (`exit_page`), ranked by sessions, for the selected window. Built directly on
 * the merged #569 S2 backend (`GET /admin/websites/:id/analytics/pages`, which
 * returns both breakdowns) via the `useWebsiteAnalyticsPages` hook.
 *
 * Two side-by-side ranked-bar columns, Medusa-token styled (follows dark mode),
 * Skeleton loading, reassuring empty state. Window (`days`) is driven by the
 * parent modal's existing time filter.
 */
export function AnalyticsEntryExitPagesCard({
  websiteId,
  days,
}: {
  websiteId: string;
  days?: number;
}) {
  const { data, isLoading } = useWebsiteAnalyticsPages(websiteId, {
    days,
    limit: 8,
  });

  const entry = data?.pages?.entry_page;
  const exit = data?.pages?.exit_page;

  return (
    <Container className="p-0 overflow-hidden rounded-lg border border-ui-border-base bg-ui-bg-base">
      <div className="p-4 border-b border-ui-border-base">
        <Heading level="h3" className="text-sm font-medium">
          Entry &amp; Exit Pages
        </Heading>
        <Text size="xsmall" className="text-ui-fg-subtle">
          Where sessions begin and end in the selected window
        </Text>
      </div>

      <div className="grid grid-cols-1 gap-px bg-ui-border-base md:grid-cols-2">
        <PageColumn
          title="Top Landing Pages"
          icon={<ArrowDownLeftMini className="text-ui-fg-subtle" />}
          breakdown={entry}
          isLoading={isLoading}
        />
        <PageColumn
          title="Top Exit Pages"
          icon={<ArrowUpRightMini className="text-ui-fg-subtle" />}
          breakdown={exit}
          isLoading={isLoading}
        />
      </div>
    </Container>
  );
}

function PageColumn({
  title,
  icon,
  breakdown,
  isLoading,
}: {
  title: string;
  icon: React.ReactNode;
  breakdown?: SessionPageBreakdown;
  isLoading: boolean;
}) {
  const results = breakdown?.results ?? [];
  const totalSessions = breakdown?.total_sessions ?? 0;
  const max = results.reduce((m, b) => Math.max(m, b.count), 0) || 1;

  return (
    <div className="bg-ui-bg-base p-4">
      <div className="mb-3 flex items-center justify-between gap-x-2">
        <div className="flex items-center gap-x-2">
          {icon}
          <Text size="small" weight="plus" className="text-ui-fg-base">
            {title}
          </Text>
        </div>
        {!isLoading && totalSessions > 0 && (
          <Text size="xsmall" className="text-ui-fg-subtle tabular-nums">
            {totalSessions.toLocaleString()} sessions
          </Text>
        )}
      </div>

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
          No session data in the selected window yet.
        </Text>
      ) : (
        <div className="flex flex-col gap-y-1">
          {results.map((b) => (
            <div
              key={b.value}
              className="group relative flex items-center justify-between overflow-hidden rounded-md px-2 py-1.5"
              title={`${b.value} — ${b.count.toLocaleString()} sessions`}
            >
              <div
                className="absolute inset-y-0 left-0 bg-ui-bg-component"
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
                <Badge size="2xsmall">{b.count.toLocaleString()}</Badge>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
