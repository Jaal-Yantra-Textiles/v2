import { Container, Heading, Text, DataTable, useDataTable, createDataTableFilterHelper, DataTablePaginationState, DataTableFilteringState } from "@medusajs/ui";
import { Outlet, useNavigate } from "react-router-dom";
import { keepPreviousData } from "@tanstack/react-query";
import { defineRouteConfig } from "@medusajs/admin-sdk";
import { ToolsSolid, PencilSquare } from "@medusajs/icons";
import CreateButton from "../../../components/creates/create-button";
import { useCallback, useMemo, useState } from "react";
import { EntityActions } from "../../../components/persons/personsActions";
import { createColumnHelper } from "@tanstack/react-table";
import { AdminInventoryOrder, AdminInventoryOrdersQuery, useInventoryOrders } from "../../../hooks/api/inventory-orders";
import { debounce } from "lodash";

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

  const handleFilterChange = useCallback(
      debounce((newFilters: DataTableFilteringState) => {
        setFiltering(newFilters);
      }, 300),
      []
    );
  
    // Debounced search change handler
    const handleSearchChange = useCallback(
      debounce((newSearch: string) => {
        setSearch(newSearch);
      }, 300),
      []
    );

  const offset = pagination.pageIndex * pagination.pageSize;

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
      q: search || undefined,
      // Process filters dynamically like in PersonsPage
      ...(Object.keys(filtering).length > 0 ? 
        Object.entries(filtering).reduce((acc: AdminInventoryOrdersQuery, [key, value]) => {
          if (!value) return acc;
          
          // Handle different filter types appropriately
          if (key === 'status') {
            // Handle status which might be an array from multi-select
            if (Array.isArray(value)) {
              // Take the first value if it's an array
              if (value.length > 0) {
                acc.status = value[0] as string;
              }
            } else {
              acc.status = value as string;
            }
          } else if (key === 'quantity') {
            // Convert string to number for quantity filter
            if (Array.isArray(value)) {
              // Take the first value if it's an array
              if (value.length > 0) {
                acc.quantity = Number(value[0]);
              }
            } else {
              acc.quantity = Number(value);
            }
          } else if (key === 'order_date') {
            acc.order_date = value as string;
          }
          return acc;
        }, {} as AdminInventoryOrdersQuery) : {}),
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
      onSearchChange: handleSearchChange,
    },
    filtering: {
      state: filtering,
      onFilteringChange: handleFilterChange,
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