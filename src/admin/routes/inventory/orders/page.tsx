import { Container, Heading, Text, DataTable, useDataTable, createDataTableFilterHelper, DataTablePaginationState, DataTableFilteringState } from "@medusajs/ui";
import { Outlet, useNavigate } from "react-router-dom";
import { keepPreviousData } from "@tanstack/react-query";
import { defineRouteConfig } from "@medusajs/admin-sdk";
import { ToolsSolid, PencilSquare } from "@medusajs/icons";
import CreateButton from "../../../components/creates/create-button";
import { useMemo, useState } from "react";
import { EntityActions } from "../../../components/persons/personsActions";
import { createColumnHelper } from "@tanstack/react-table";
import { AdminInventoryOrder, useInventoryOrders } from "../../../hooks/api/inventory-orders";

const columnHelper = createColumnHelper<AdminInventoryOrder>();
export const useColumns = () => {
  // Placeholder: Replace with a dedicated hook if needed
  const columns = useMemo(() => [
    columnHelper.accessor("id", { header: "Order ID" }),
    columnHelper.accessor("status", { header: "Status" }),
    columnHelper.accessor("quantity", { header: "Quantity" }),
    columnHelper.accessor("total_price", { header: "Total Price" }),
    columnHelper.accessor("order_date", {
      header: "Order Date",
      cell: info => {
        const val = info.getValue<string>();
        return val ? new Date(val).toLocaleDateString() : "-";
      },
    }),
    columnHelper.accessor("expected_delivery_date", {
      header: "Expected Delivery",
      cell: info => {
        const val = info.getValue<string>();
        return val ? new Date(val).toLocaleDateString() : "-";
      },
    }),
  ], []);

  const orderActionsConfig = {
    actions: [
      {
        icon: <PencilSquare />,
        label: "Edit",
        to: (order: AdminInventoryOrder) => `/inventory/orders/${order.id}/edit`,
      },
      // Add more actions as needed
    ],
  };

  return useMemo(
    () => [
      ...columns,
      columnHelper.display({
        id: "actions",
        cell: ({ row }) => (
          <EntityActions
            entity={row.original}
            actionsConfig={orderActionsConfig}
          />
        ),
      }),
    ],
    [columns],
  );
};

const InventoryOrdersPage = () => {
  const navigate = useNavigate();
  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageSize: 10,
    pageIndex: 0,
  });
  const [filtering, setFiltering] = useState<DataTableFilteringState>({});
  const [search, setSearch] = useState<string>("");

  const offset = pagination.pageIndex * pagination.pageSize;

  // Defensive: safely extract filter values for API
  const status = typeof filtering.status === "string" ? filtering.status : undefined;
  const quantity = typeof filtering.quantity === "number" ? filtering.quantity : undefined;
  const order_date = typeof filtering.order_date === "string" ? filtering.order_date : undefined;

  const {
    inventory_orders,
    count,
    isLoading,
    isError,
    error,
  } = useInventoryOrders(
    {
      limit: pagination.pageSize,
      offset: offset,
      status,
      quantity,
      order_date,
    },
    {
      placeholderData: keepPreviousData,
    },
  );

  const columns = useColumns();
  const filterHelper = createDataTableFilterHelper<AdminInventoryOrder>();
  const filters = [
    filterHelper.accessor("status", {
      type: "select",
      label: "Status",
      options: [
        { label: "Pending", value: "Pending" },
        { label: "Processing", value: "Processing" },
        { label: "Shipped", value: "Shipped" },
        { label: "Delivered", value: "Delivered" },
        { label: "Cancelled", value: "Cancelled" },
      ],
    }),
    filterHelper.accessor("quantity", {
      type: "select",
      label: "Quantity",
      options: [
        { label: "1", value: "1" },
        { label: "5", value: "5" },
        { label: "10", value: "10" },
        { label: "20", value: "20" },
      ],
    }),
    filterHelper.accessor("order_date", {
      type: "date",
      label: "Order Date",
      options: [], // Required by DataTableDateFilterProps, can be empty for date picker
    }),
    // Add more filters as needed
  ];

  const table = useDataTable({
    columns,
    data: inventory_orders ?? [],
    getRowId: (row) => row.id as string,
    onRowClick: (_, row) => {
      navigate(`/inventory/orders/${row.id}`);
    },
    rowCount: count,
    isLoading,
    filters,
    pagination: {
      state: pagination,
      onPaginationChange: setPagination,
    },
    search: {
      state: search,
      onSearchChange: setSearch,
    },
    filtering: {
      state: filtering,
      onFilteringChange: setFiltering,
    },
  });

  if (isError) {
    throw error;
  }

  return (
    <div>
      <Container className="divide-y p-0">
        <DataTable instance={table}>
          {/* Header section with title and create button */}
          <DataTable.Toolbar className="flex justify-between items-center px-6 py-4">
            <div>
              <Heading>Inventory Orders</Heading>
              <Text className="text-ui-fg-subtle" size="small">
                Manage all your inventory orders from here
              </Text>
            </div>
            <div className="flex items-center gap-x-2">
              <CreateButton />
            </div>
          </DataTable.Toolbar>

          {/* Search and filter section in its own container with divider */}
          <div className="flex items-start justify-between gap-x-4 px-6 py-4 border-t border-ui-border-base">
            <div className="w-full max-w-[60%]">
              <DataTable.FilterMenu tooltip="Filter inventory orders" />
            </div>
            <div className="flex shrink-0 items-center gap-x-2">
              <DataTable.Search placeholder="Search inventory orders..." />
            </div>
          </div>

          <DataTable.Table />
          <DataTable.Pagination />
        </DataTable>
      </Container>
      <Outlet />
    </div>
  );
};

export default InventoryOrdersPage;

export const config = defineRouteConfig({
  label: "Orders",
  nested: "/inventory",
  icon: ToolsSolid,
});

export const handle = {
  breadcrumb: () => "Inventory Orders",
};