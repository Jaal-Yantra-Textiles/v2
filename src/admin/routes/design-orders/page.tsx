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
  toast,
  usePrompt,
  TooltipProvider,
  Tooltip,
} from "@medusajs/ui";
import { useNavigate } from "react-router-dom";
import { keepPreviousData } from "@tanstack/react-query";
import { defineRouteConfig } from "@medusajs/admin-sdk";
import { ReceiptPercent, XCircle, CheckCircleSolid } from "@medusajs/icons";
import { useCallback, useMemo, useState } from "react";
import { EntityActions } from "../../components/persons/personsActions";
import { createColumnHelper } from "@tanstack/react-table";
import debounce from "lodash/debounce";
import {
  DesignOrderItem,
  DesignOrderLineItem,
  DesignOrdersQuery,
  useDesignOrders,
  useApproveDesign,
  useCancelDesignOrder,
} from "../../hooks/api/design-orders";

// ─── Status helpers ─────────────────────────────────────────────────────────

const getDesignStatusColor = (
  status: string
): "blue" | "green" | "orange" | "red" | "purple" | "grey" => {
  switch (status) {
    case "Commerce_Ready":
      return "blue";
    case "Approved":
      return "green";
    case "In_Development":
      return "orange";
    case "Sample_Production":
      return "orange";
    case "Technical_Review":
      return "purple";
    case "Revision":
      return "red";
    case "Rejected":
      return "red";
    case "On_Hold":
      return "grey";
    default:
      return "grey";
  }
};

const getPaymentStatusColor = (
  status: string
): "blue" | "green" | "orange" | "red" | "grey" => {
  switch (status) {
    case "captured":
    case "partially_captured":
      return "green";
    case "awaiting":
    case "requires_action":
      return "orange";
    case "canceled":
    case "refunded":
    case "partially_refunded":
      return "red";
    default:
      return "grey";
  }
};

const getFulfillmentStatusColor = (
  status: string
): "blue" | "green" | "orange" | "red" | "grey" => {
  switch (status) {
    case "fulfilled":
    case "shipped":
    case "delivered":
      return "green";
    case "partially_fulfilled":
    case "partially_shipped":
      return "orange";
    case "canceled":
      return "red";
    case "not_fulfilled":
    default:
      return "grey";
  }
};

const formatCurrency = (amount: number, currencyCode = "inr") => {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: currencyCode.toUpperCase(),
  }).format(amount);
};

// ─── Row actions component ────────────────────────────────────────────────────

const DesignOrderActions = ({ row }: { row: DesignOrderItem }) => {
  const prompt = usePrompt();
  const firstDesign = row.items[0]?.design;
  const { mutateAsync: approve, isPending: isApproving } = useApproveDesign(
    firstDesign?.id ?? ""
  );
  const { mutateAsync: cancelOrder, isPending: isCanceling } =
    useCancelDesignOrder(row.order?.id ?? "");

  const handleApprove = async () => {
    const designNames = row.items.map((i) => i.design.name).join(", ");
    const confirmed = await prompt({
      title: "Approve designs?",
      description: `This will create products and variants for: ${designNames}`,
      confirmText: "Approve",
      cancelText: "Cancel",
    });
    if (!confirmed) return;

    await approve(undefined, {
      onSuccess: () => toast.success(`Designs approved`),
      onError: (e) => toast.error(e.message),
    });
  };

  const handleCancel = async () => {
    const confirmed = await prompt({
      title: "Cancel order?",
      description: `This will cancel order #${row.order?.display_id}. This cannot be undone.`,
      confirmText: "Cancel order",
      cancelText: "Go back",
    });
    if (!confirmed) return;

    await cancelOrder(undefined, {
      onSuccess: () =>
        toast.success(`Order #${row.order?.display_id} canceled`),
      onError: (e) => toast.error(e.message),
    });
  };

  const allApproved = row.items.every((i) => i.design.status === "Approved");
  const hasOrder = !!row.order;
  const isCanceled = !!row.order?.canceled_at;

  return (
    <EntityActions
      entity={row}
      actionsConfig={{
        actions: [
          {
            icon: <CheckCircleSolid />,
            label: "Approve designs",
            disabled: allApproved || isApproving,
            disabledTooltip: allApproved
              ? "All approved"
              : isApproving
              ? "Approving..."
              : undefined,
            onClick: handleApprove,
          },
          {
            icon: <XCircle />,
            label: "Cancel order",
            disabled: !hasOrder || isCanceled || isCanceling,
            disabledTooltip: !hasOrder
              ? "No order yet"
              : isCanceled
              ? "Already canceled"
              : isCanceling
              ? "Canceling..."
              : undefined,
            onClick: handleCancel,
          },
        ],
      }}
    />
  );
};

// ─── Columns ─────────────────────────────────────────────────────────────────

const columnHelper = createColumnHelper<DesignOrderItem>();

const useColumns = () =>
  useMemo(
    () => [
      columnHelper.accessor("items", {
        header: "Designs",
        cell: ({ getValue }) => {
          const items = getValue();
          if (!items.length) return <span className="text-ui-fg-muted">—</span>;
          const first = items[0];
          const rest = items.slice(1);
          return (
            <div className="flex items-center gap-x-1.5">
              <span className="font-medium">{first.design.name}</span>
              <Badge
                color={getDesignStatusColor(first.design.status)}
                size="2xsmall"
              >
                {first.design.status.replace(/_/g, " ")}
              </Badge>
              {rest.length > 0 && (
                <Tooltip
                  content={rest.map((item: DesignOrderLineItem) => item.design.name).join(", ")}
                >
                  <Badge size="2xsmall" color="grey" className="cursor-default">
                    +{rest.length} more
                  </Badge>
                </Tooltip>
              )}
            </div>
          );
        },
      }),
      columnHelper.accessor("customer", {
        header: "Customer",
        cell: ({ getValue }) => {
          const c = getValue();
          if (!c) return <span className="text-ui-fg-muted">—</span>;
          return (
            <div>
              <span>
                {c.first_name} {c.last_name}
              </span>
              <div className="text-ui-fg-subtle text-xs">{c.email}</div>
            </div>
          );
        },
      }),
      columnHelper.accessor("order", {
        header: "Order",
        cell: ({ getValue }) => {
          const order = getValue();
          if (!order)
            return (
              <Badge color="grey" size="2xsmall">
                In Cart
              </Badge>
            );
          return (
            <span className="font-medium">#{order.display_id}</span>
          );
        },
      }),
      columnHelper.accessor("order", {
        id: "payment_status",
        header: "Payment",
        cell: ({ getValue }) => {
          const order = getValue();
          if (!order) return <span className="text-ui-fg-muted">—</span>;
          return (
            <Badge
              color={getPaymentStatusColor(order.payment_status)}
              size="2xsmall"
            >
              {order.payment_status.replace(/_/g, " ")}
            </Badge>
          );
        },
      }),
      columnHelper.accessor("total_price", {
        header: "Total",
        cell: ({ getValue, row }) => {
          const price = getValue();
          const currency = row.original.cart?.currency_code ?? row.original.order?.currency_code ?? "inr";
          if (!price) return <span className="text-ui-fg-muted">—</span>;
          return <span>{formatCurrency(price, currency)}</span>;
        },
      }),
      columnHelper.accessor("created_at", {
        header: "Created",
        cell: ({ getValue }) => {
          const date = getValue();
          if (!date) return "—";
          return new Date(date).toLocaleDateString();
        },
      }),
      columnHelper.display({
        id: "actions",
        cell: ({ row }) => <DesignOrderActions row={row.original} />,
      }),
    ],
    []
  );

// ─── Page ─────────────────────────────────────────────────────────────────────

const filterHelper = createDataTableFilterHelper<DesignOrderItem>();

const DesignOrdersPage = () => {
  const navigate = useNavigate();

  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageSize: 20,
    pageIndex: 0,
  });
  const [filtering, setFiltering] = useState<DataTableFilteringState>({});
  const [search, setSearch] = useState<string>("");

  const handleFilterChange = useCallback(
    debounce((newFilters: DataTableFilteringState) => setFiltering(newFilters), 300),
    []
  );

  const handleSearchChange = useCallback(
    debounce((newSearch: string) => setSearch(newSearch), 300),
    []
  );

  const offset = pagination.pageIndex * pagination.pageSize;

  const queryParams: DesignOrdersQuery = {
    limit: pagination.pageSize,
    offset,
  };

  const { design_orders, count, isLoading, isError, error } = useDesignOrders(
    queryParams,
    { placeholderData: keepPreviousData }
  );

  // Client-side search filter
  const filteredRows = useMemo(() => {
    if (!design_orders) return [];
    const q = search.toLowerCase();
    if (!q) return design_orders;
    return design_orders.filter(
      (row) =>
        row.items.some((item) => item.design.name.toLowerCase().includes(q)) ||
        row.customer?.email?.toLowerCase().includes(q) ||
        row.customer?.first_name?.toLowerCase().includes(q) ||
        row.customer?.last_name?.toLowerCase().includes(q) ||
        String(row.order?.display_id ?? "").includes(q)
    );
  }, [design_orders, search]);

  const filters = [
    filterHelper.accessor("design" as any, {
      type: "select",
      label: "Design Status",
      options: [
        { label: "Commerce Ready", value: "Commerce_Ready" },
        { label: "Approved", value: "Approved" },
        { label: "In Development", value: "In_Development" },
        { label: "Rejected", value: "Rejected" },
        { label: "On Hold", value: "On_Hold" },
      ],
    }),
  ];

  const columns = useColumns();

  const table = useDataTable({
    columns,
    data: filteredRows,
    getRowId: (row) => row.cart_id,
    onRowClick: (_, row) => navigate(`/design-orders/${row.original.items[0]?.line_item_id}`),
    rowCount: count ?? 0,
    isLoading,
    filters,
    pagination: {
      state: pagination,
      onPaginationChange: setPagination,
    },
    search: {
      state: search,
      onSearchChange: handleSearchChange,
    },
    filtering: {
      state: filtering,
      onFilteringChange: handleFilterChange,
    },
  });

  if (isError) throw error;

  return (
    <TooltipProvider>
      <Container className="divide-y p-0">
        <DataTable instance={table}>
          <DataTable.Toolbar className="flex flex-col md:flex-row justify-between gap-y-4 px-6 py-4">
            <div>
              <Heading>Design Orders</Heading>
              <Text className="text-ui-fg-subtle" size="small">
                Designs added to carts and converted to orders
              </Text>
            </div>
            <div className="flex items-center gap-x-2">
              <DataTable.Search placeholder="Search designs, customers..." />
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

export default DesignOrdersPage;

export const config = defineRouteConfig({
  label: "Design Orders",
  nested: "/orders",
  icon: ReceiptPercent,
});

export const handle = {
  breadcrumb: () => "Design Orders",
};
