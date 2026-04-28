import {
  Container,
  Heading,
  Text,
  DataTable,
  useDataTable,
  createDataTableFilterHelper,
  DataTablePaginationState,
  DataTableFilteringState,
  Badge,
  Tooltip,
  TooltipProvider,
} from "@medusajs/ui";
import { useNavigate } from "react-router-dom";
import { keepPreviousData } from "@tanstack/react-query";
import { defineRouteConfig } from "@medusajs/admin-sdk";
import { ShoppingCart } from "@medusajs/icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import debounce from "lodash/debounce";
import {
  AbandonedCartListItem,
  AbandonedCartTier,
  AbandonedCartsQuery,
  useAbandonedCarts,
} from "../../hooks/api/abandoned-carts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const formatCurrency = (amount: number, currencyCode = "inr") =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: currencyCode.toUpperCase(),
    maximumFractionDigits: 2,
  }).format(amount);

const formatIdle = (minutes: number) => {
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

// Idle threshold options. Backed-by minutes value sent to the API.
const IDLE_OPTIONS: Array<{ label: string; value: string }> = [
  { label: "30m", value: "30" },
  { label: "1h", value: "60" },
  { label: "4h", value: "240" },
  { label: "24h", value: "1440" },
  { label: "3d", value: "4320" },
  { label: "7d", value: "10080" },
];

// Tier options shown in the FilterMenu. Defaulting to `has_items` filters
// out the empty browse-carts that storefront page-loads create.
const TIER_OPTIONS: Array<{ label: string; value: AbandonedCartTier; help: string }> = [
  { label: "All", value: "all", help: "Every non-completed cart, including empty browse-carts." },
  { label: "Has items", value: "has_items", help: "At least one line item in the cart." },
  { label: "Recoverable", value: "recoverable", help: "Has items and a contact (email or customer)." },
  { label: "Checkout", value: "checkout", help: "Has items, contact, and shipping address." },
];

// ─── Columns ─────────────────────────────────────────────────────────────────

const columnHelper = createColumnHelper<AbandonedCartListItem>();

const useColumns = () =>
  useMemo(
    () => [
      columnHelper.accessor("items_preview", {
        header: "Items",
        cell: ({ getValue, row }) => {
          const preview = getValue();
          const total = row.original.items_count;
          if (!preview.length) {
            return <span className="text-ui-fg-muted">Empty</span>;
          }
          const first = preview[0];
          const rest = preview.slice(1);
          return (
            <div className="flex items-center gap-x-1.5">
              <span className="font-medium truncate max-w-[180px]">{first.title ?? "Untitled"}</span>
              {rest.length > 0 && (
                <Tooltip content={rest.map((i) => i.title ?? "Untitled").join(", ")}>
                  <Badge size="2xsmall" color="grey" className="cursor-default">
                    +{total - 1} more
                  </Badge>
                </Tooltip>
              )}
            </div>
          );
        },
      }),
      columnHelper.accessor("customer", {
        header: "Customer",
        cell: ({ getValue, row }) => {
          const c = getValue();
          const email = c?.email ?? row.original.email;
          if (!c && !email)
            return (
              <Badge color="grey" size="2xsmall">
                Guest
              </Badge>
            );
          const fullName = [c?.first_name, c?.last_name].filter(Boolean).join(" ");
          return (
            <div className="flex flex-col">
              {fullName && <span className="text-ui-fg-base">{fullName}</span>}
              <span className="text-ui-fg-subtle text-xs">{email ?? "—"}</span>
            </div>
          );
        },
      }),
      columnHelper.accessor("items_subtotal", {
        header: "Subtotal",
        cell: ({ getValue, row }) => {
          const v = getValue();
          if (!v) return <span className="text-ui-fg-muted">—</span>;
          return <span>{formatCurrency(v, row.original.currency_code)}</span>;
        },
      }),
      columnHelper.accessor("sales_channel", {
        header: "Channel",
        cell: ({ getValue }) => {
          const sc = getValue();
          if (!sc) return <span className="text-ui-fg-muted">—</span>;
          return (
            <Badge size="2xsmall" color="grey">
              {sc.name}
            </Badge>
          );
        },
      }),
      columnHelper.accessor("idle_minutes", {
        header: "Last activity",
        cell: ({ getValue }) => <span className="text-ui-fg-subtle">{formatIdle(getValue())}</span>,
      }),
      columnHelper.accessor("recovery_email_sent_at", {
        header: "Recovery",
        cell: ({ getValue }) => {
          const sentAt = getValue();
          if (!sentAt)
            return (
              <Badge size="2xsmall" color="grey">
                Not sent
              </Badge>
            );
          return (
            <Badge size="2xsmall" color="blue">
              Sent {formatIdle(Math.round((Date.now() - new Date(sentAt).getTime()) / 60000))}
            </Badge>
          );
        },
      }),
    ],
    [],
  );

// ─── Page ─────────────────────────────────────────────────────────────────────

const filterHelper = createDataTableFilterHelper<AbandonedCartListItem>();

const AbandonedCartsPage = () => {
  const navigate = useNavigate();

  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageSize: 20,
    pageIndex: 0,
  });
  const [filtering, setFiltering] = useState<DataTableFilteringState>({});
  const [search, setSearch] = useState<string>("");

  // Filter clicks are discrete events — don't debounce them. Medusa's
  // FilterMenu fires onFilteringChange three times per interaction
  // (pick filter → pick value → close popover); a debounce here lets
  // the close fire against stale state and the popover's onOpenChange
  // helpfully calls instance.removeFilter, wiping the value the user
  // just picked. Debouncing only ever made sense for the search input.
  const handleFilterChange = useCallback(
    (newFilters: DataTableFilteringState) => setFiltering(newFilters),
    [],
  );

  const handleSearchChange = useCallback(
    debounce((newSearch: string) => setSearch(newSearch), 300),
    [],
  );

  // Filter values come from the FilterMenu's `filtering` state. The
  // DataTable returns select-filter values as `string | string[]` —
  // checked elsewhere in the codebase (see saved-reports-tab.tsx).
  // The previous implementation only handled the bare-string case and
  // silently fell back to defaults whenever the array shape was
  // returned, which made the whole FilterMenu look inert.
  const readFilterValue = (key: string): string | undefined => {
    const v = filtering[key];
    if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : undefined;
    return typeof v === "string" ? v : undefined;
  };

  const tier: AbandonedCartTier =
    (readFilterValue("tier") as AbandonedCartTier | undefined) ?? "has_items";
  const idleMinutes = readFilterValue("idle_minutes") ?? "60";
  const hasShipping = readFilterValue("has_shipping") as
    | "yes"
    | "no"
    | undefined;

  // Reset pagination when filters or search change — otherwise switching
  // tier on page 5 leaves you stranded on a non-existent page.
  useEffect(() => {
    setPagination((prev) => (prev.pageIndex === 0 ? prev : { ...prev, pageIndex: 0 }));
  }, [tier, idleMinutes, hasShipping, search]);

  const offset = pagination.pageIndex * pagination.pageSize;

  const queryParams: AbandonedCartsQuery = {
    tier,
    idle_minutes: Number(idleMinutes),
    has_shipping: hasShipping,
    limit: pagination.pageSize,
    offset,
    q: search || undefined,
  };

  const {
    abandoned_carts,
    count,
    isLoading,
    isError,
    error,
  } = useAbandonedCarts(queryParams, { placeholderData: keepPreviousData });

  const filters = [
    filterHelper.accessor("tier" as any, {
      type: "select",
      label: "Tier",
      options: TIER_OPTIONS.map((opt) => ({ label: opt.label, value: opt.value })),
    }),
    filterHelper.accessor("idle_minutes" as any, {
      type: "select",
      label: "Idle for at least",
      options: IDLE_OPTIONS,
    }),
    filterHelper.accessor("has_shipping" as any, {
      type: "select",
      label: "Has shipping address",
      options: [
        { label: "Yes", value: "yes" },
        { label: "No", value: "no" },
      ],
    }),
  ];

  const columns = useColumns();

  const table = useDataTable({
    columns,
    data: abandoned_carts ?? [],
    getRowId: (row) => row.id,
    onRowClick: (_, row) => navigate(`/abandoned-carts/${(row as any).original?.id ?? row.id}`),
    rowCount: count ?? 0,
    isLoading,
    filters,
    pagination: { state: pagination, onPaginationChange: setPagination },
    search: { state: search, onSearchChange: handleSearchChange },
    filtering: { state: filtering, onFilteringChange: handleFilterChange },
  });

  if (isError) throw error;

  return (
    <TooltipProvider>
      <Container className="divide-y p-0">
        <DataTable instance={table}>
          <DataTable.Toolbar className="flex flex-col md:flex-row md:items-center justify-between gap-y-3 gap-x-4 px-6 py-4">
            <div>
              <Heading>Abandoned Carts</Heading>
              <Text className="text-ui-fg-subtle" size="small">
                Storefront carts that were started but never converted into an order.
              </Text>
            </div>
            <div className="flex items-center gap-x-2">
              <DataTable.Search placeholder="Search id, email, customer..." />
              <DataTable.FilterMenu tooltip="Filter" />
            </div>
          </DataTable.Toolbar>
          <DataTable.Table />
          <DataTable.Pagination />
        </DataTable>
      </Container>
    </TooltipProvider>
  );
};

export default AbandonedCartsPage;

export const config = defineRouteConfig({
  label: "Abandoned Carts",
  nested: "/orders",
  icon: ShoppingCart,
});

export const handle = {
  breadcrumb: () => "Abandoned Carts",
};
