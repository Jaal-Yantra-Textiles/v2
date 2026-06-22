import {
  Container,
  Heading,
  Text,
  Badge,
  DataTable,
  useDataTable,
  DataTablePaginationState,
} from "@medusajs/ui";
import { Users } from "@medusajs/icons";
import { keepPreviousData } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import {
  useWebsiteAnalyticsSessions,
  type AnalyticsSession,
} from "../../hooks/api/analytics";

/**
 * #569 S7b — Sessions DataTable card.
 *
 * Paginated table of individual visitor sessions for the selected window, built
 * directly on the merged #569 S7a backend
 * (`GET /admin/websites/:id/analytics/sessions`) via the
 * `useWebsiteAnalyticsSessions` hook. Server-side pagination (limit/offset);
 * Medusa-native `DataTable`/`useDataTable` so it follows dark mode for free and
 * matches the rest of the admin. Window (`days`) is driven by the parent
 * modal's existing time filter.
 */

const columnHelper = createColumnHelper<AnalyticsSession>();

function formatDuration(seconds?: number | null): string {
  if (!seconds || seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function formatStarted(value?: string | Date | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

export function AnalyticsSessionsCard({
  websiteId,
  days,
}: {
  websiteId: string;
  days?: number;
}) {
  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageSize: 10,
    pageIndex: 0,
  });

  const offset = pagination.pageIndex * pagination.pageSize;

  const { data, isLoading } = useWebsiteAnalyticsSessions(
    websiteId,
    {
      days,
      limit: pagination.pageSize,
      offset,
      order_by: "started_at",
      order_dir: "DESC",
    },
    { placeholderData: keepPreviousData }
  );

  const sessions = data?.sessions ?? [];
  const count = data?.count ?? 0;

  const columns = useMemo(
    () => [
      columnHelper.accessor("entry_page", {
        header: "Entry page",
        cell: ({ getValue }) => (
          <Text size="small" className="truncate font-mono max-w-[220px]">
            {getValue() || "(none)"}
          </Text>
        ),
      }),
      columnHelper.accessor("pageviews", {
        header: "Views",
        cell: ({ getValue, row }) => (
          <div className="flex items-center gap-x-2">
            <Text size="small" className="tabular-nums">
              {getValue() ?? 0}
            </Text>
            {row.original.is_bounce && (
              <Badge size="2xsmall" color="orange">
                bounce
              </Badge>
            )}
          </div>
        ),
      }),
      columnHelper.accessor("duration_seconds", {
        header: "Duration",
        cell: ({ getValue }) => (
          <Text size="small" className="tabular-nums text-ui-fg-subtle">
            {formatDuration(getValue())}
          </Text>
        ),
      }),
      columnHelper.accessor("referrer_source", {
        header: "Source",
        cell: ({ getValue }) => (
          <Text size="small" className="text-ui-fg-subtle">
            {getValue() || "direct"}
          </Text>
        ),
      }),
      columnHelper.accessor("device_type", {
        header: "Device",
        cell: ({ getValue, row }) => {
          const device = getValue();
          const browser = row.original.browser;
          return (
            <Text size="small" className="text-ui-fg-subtle">
              {[device, browser].filter(Boolean).join(" · ") || "—"}
            </Text>
          );
        },
      }),
      columnHelper.accessor("country", {
        header: "Country",
        cell: ({ getValue }) => (
          <Text size="small" className="text-ui-fg-subtle">
            {getValue() || "—"}
          </Text>
        ),
      }),
      columnHelper.accessor("started_at", {
        header: "Started",
        cell: ({ getValue }) => (
          <Text size="xsmall" className="text-ui-fg-muted whitespace-nowrap">
            {formatStarted(getValue())}
          </Text>
        ),
      }),
    ],
    []
  );

  const table = useDataTable({
    columns,
    data: sessions,
    getRowId: (row) => row.id,
    rowCount: count,
    isLoading,
    pagination: {
      state: pagination,
      onPaginationChange: setPagination,
    },
  });

  return (
    <Container className="p-0 overflow-hidden rounded-lg border border-ui-border-base bg-ui-bg-base divide-y divide-ui-border-base">
      <div className="p-4 flex items-center justify-between gap-x-2">
        <div className="flex items-center gap-x-2">
          <Users className="text-ui-fg-subtle" />
          <div>
            <Heading level="h3" className="text-sm font-medium">
              Sessions
            </Heading>
            <Text size="xsmall" className="text-ui-fg-subtle">
              Individual visitor sessions in the selected window
            </Text>
          </div>
        </div>
        {!isLoading && count > 0 && (
          <Text size="xsmall" className="text-ui-fg-subtle tabular-nums">
            {count.toLocaleString()} sessions
          </Text>
        )}
      </div>

      {!isLoading && count === 0 ? (
        <Text size="small" className="text-ui-fg-subtle py-6 text-center block">
          No sessions recorded in the selected window yet.
        </Text>
      ) : (
        <DataTable instance={table}>
          <DataTable.Table />
          <DataTable.Pagination />
        </DataTable>
      )}
    </Container>
  );
}
