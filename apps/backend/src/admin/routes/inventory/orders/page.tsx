import {
  Container,
  Heading,
  Text,
  DataTable,
  useDataTable,
  createDataTableFilterHelper,
  DataTablePaginationState,
  DataTableFilteringState,
  Button,
  Badge,
} from "@medusajs/ui";
import { Outlet, useNavigate, useSearchParams } from "react-router-dom";
import { keepPreviousData } from "@tanstack/react-query";
import { defineRouteConfig } from "@medusajs/admin-sdk";
import { ToolsSolid, PencilSquare } from "@medusajs/icons";
import CreateButton from "../../../components/creates/create-button";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EntityActions } from "../../../components/persons/personsActions";
import { createColumnHelper } from "@tanstack/react-table";
import { AdminInventoryOrder, AdminInventoryOrdersQuery, useInventoryOrders } from "../../../hooks/api/inventory-orders";
import debounce from "lodash/debounce";
import isEqual from "lodash/isEqual";
import { SaveViewDialog } from "../../../components/views/save-view-dialog";
import { useViewConfigurationActions } from "../../../hooks/use-view-configurations";
import type { ViewConfiguration } from "../../../hooks/api/views";
import { usePartners } from "../../../hooks/api/partners";

const columnHelper = createColumnHelper<AdminInventoryOrder>();
export const useColumns = () => {
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
  const [, setSearchParams] = useSearchParams();

  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageSize: 10,
    pageIndex: 0,
  });
  const [filtering, setFiltering] = useState<DataTableFilteringState>({});
  const [search, setSearch] = useState<string>("");
  const [selectedViewId, setSelectedViewId] = useState("default");
  const [initializedFromView, setInitializedFromView] = useState(false);
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [editingView, setEditingView] = useState<ViewConfiguration | null>(null);
  const [baselineConfiguration, setBaselineConfiguration] = useState<{
    filters: DataTableFilteringState;
    search: string;
  }>({
    filters: {},
    search: "",
  });
  const [tableUiResetKey, setTableUiResetKey] = useState(0);

  const {
    listViews,
    activeView,
    setActiveView,
  } = useViewConfigurationActions("inventory_orders");
  const views = listViews.data?.view_configurations || [];
  const currentActiveView = activeView.data?.view_configuration || null;

  const handleFilterChange = useCallback(
    debounce((newFilters: DataTableFilteringState) => {
      setFiltering(newFilters);
    }, 300),
    []
  );

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
      ...(Object.keys(filtering).length > 0 ?
        Object.entries(filtering).reduce((acc: AdminInventoryOrdersQuery, [key, value]) => {
          if (!value) return acc;

          if (key === 'status') {
            if (Array.isArray(value)) {
              if (value.length > 0) {
                acc.status = value[0] as string;
              }
            } else {
              acc.status = value as string;
            }
          } else if (key === 'quantity') {
            if (Array.isArray(value)) {
              if (value.length > 0) {
                acc.quantity = Number(value[0]);
              }
            } else {
              acc.quantity = Number(value);
            }
          } else if (key === 'order_date') {
            acc.order_date = value as string;
          } else if (key === 'partner_id') {
            const partnerValue = Array.isArray(value) ? value[0] : value;
            if (partnerValue) {
              (acc as any).partner_id = partnerValue as string;
            }
          }
          return acc;
        }, {} as AdminInventoryOrdersQuery) : {}),
    },
    {
      placeholderData: keepPreviousData,
    },
  );

  const columns = useColumns();
  const { partners: partnerResults = [] } = usePartners({ limit: 100, offset: 0 });
  const partnerFilterOptions = useMemo(
    () =>
      (partnerResults || [])
        .filter((partner) => partner?.id && partner?.name)
        .map((partner) => ({
          label: partner.name,
          value: partner.id,
        })),
    [partnerResults],
  );

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
      options: [],
    }),
    filterHelper.accessor("partner_id" as any, {
      type: "select",
      label: "Partner",
      options: partnerFilterOptions,
    }),
  ];

  const filterIds = useMemo(() => filters.map((filter) => filter.id), [filters]);

  const syncFiltersToSearchParams = useCallback(
    (filtersState: DataTableFilteringState, searchValue?: string) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        filterIds.forEach((filterId) => next.delete(filterId));
        next.delete("offset");

        Object.entries(filtersState).forEach(([key, value]) => {
          if (
            value === undefined ||
            value === null ||
            (typeof value === "string" && value.trim() === "") ||
            (Array.isArray(value) && value.length === 0) ||
            (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0)
          ) {
            next.delete(key);
            return;
          }
          const stringValue =
            typeof value === "string" ? value : JSON.stringify(value);
          next.set(key, stringValue);
        });

        if (searchValue) {
          next.set("q", searchValue);
        } else {
          next.delete("q");
        }

        return next;
      });
    },
    [filterIds, setSearchParams],
  );

  const normalizeFilteringState = useCallback(
    (state: DataTableFilteringState) => {
      return Object.entries(state).reduce<DataTableFilteringState>((acc, [key, value]) => {
        if (
          value === undefined ||
          value === null ||
          (typeof value === "string" && value.trim() === "") ||
          (Array.isArray(value) && value.length === 0) ||
          (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0)
        ) {
          return acc;
        }
        acc[key] = value;
        return acc;
      }, {});
    },
    [],
  );

  const applyViewConfiguration = useCallback(
    (
      config?: ViewConfiguration["configuration"] | null,
      options?: { setBaseline?: boolean },
    ) => {
      const nextFilters = config?.filters || {};
      const nextSearch = config?.search || "";
      setFiltering(nextFilters);
      setSearch(nextSearch);
      syncFiltersToSearchParams(nextFilters, nextSearch);
      setTableUiResetKey((prev) => prev + 1);

      if (options?.setBaseline) {
        setBaselineConfiguration({
          filters: normalizeFilteringState(nextFilters),
          search: nextSearch,
        });
      }
    },
    [normalizeFilteringState, syncFiltersToSearchParams],
  );

  useEffect(() => {
    if (!currentActiveView || initializedFromView) {
      return;
    }
    applyViewConfiguration(currentActiveView.configuration, { setBaseline: true });
    setInitializedFromView(true);
  }, [applyViewConfiguration, currentActiveView, initializedFromView]);

  useEffect(() => {
    setSelectedViewId(currentActiveView?.id || "default");
  }, [currentActiveView]);

  const handleViewSelect = async (value: string) => {
    setSelectedViewId(value);
    if (value === "default") {
      await setActiveView.mutateAsync(null);
      applyViewConfiguration(null, { setBaseline: true });
      return;
    }

    await setActiveView.mutateAsync(value);
    const selectedView = views.find((view) => view.id === value);
    applyViewConfiguration(selectedView?.configuration || null, {
      setBaseline: true,
    });
  };

  const normalizedFiltering = useMemo(
    () => normalizeFilteringState(filtering),
    [filtering, normalizeFilteringState],
  );

  const currentConfiguration = useMemo(
    () => ({
      filters: normalizedFiltering,
      sorting: null,
      search,
    }),
    [normalizedFiltering, search],
  );

  const hasConfigurationChanged = useMemo(() => {
    return (
      !isEqual(normalizedFiltering, baselineConfiguration.filters) ||
      (search || "") !== (baselineConfiguration.search || "")
    );
  }, [baselineConfiguration, normalizedFiltering, search]);

  const handleSaveView = () => {
    setEditingView(null);
    setIsSaveDialogOpen(true);
  };

  const handleUpdateView = () => {
    if (!currentActiveView) {
      return;
    }
    setEditingView(currentActiveView);
    setIsSaveDialogOpen(true);
  };

  const handleDialogClose = () => {
    setIsSaveDialogOpen(false);
    setEditingView(null);
  };

  const handleViewSaved = (view: ViewConfiguration) => {
    setIsSaveDialogOpen(false);
    setEditingView(null);
    applyViewConfiguration(view.configuration, { setBaseline: true });
    setSelectedViewId(view.id);
  };

  const isViewSelectorDisabled =
    setActiveView.isPending || listViews.isLoading || activeView.isLoading;

  const filterBarContent = hasConfigurationChanged ? (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button size="small" variant="secondary" onClick={handleSaveView}>
        Save view
      </Button>
      {currentActiveView && (
        <Button size="small" variant="secondary" onClick={handleUpdateView}>
          Update view
        </Button>
      )}
    </div>
  ) : null;

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
        <DataTable key={tableUiResetKey} instance={table}>
          <DataTable.Toolbar
            filterBarContent={filterBarContent}
            className="flex flex-col md:flex-row justify-between gap-y-4 px-6 py-4"
          >
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <Heading>Inventory Orders</Heading>
                <Text className="text-ui-fg-subtle" size="small">
                  Manage all your inventory orders from here
                </Text>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleViewSelect("default")}
                  disabled={isViewSelectorDisabled}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                    selectedViewId === "default"
                      ? "border-ui-border-strong bg-ui-bg-subtle text-ui-fg-base"
                      : "border-transparent bg-ui-bg-base text-ui-fg-subtle hover:text-ui-fg-base"
                  }`}
                >
                  Default
                </button>
                |
                {views.map((view) => (
                  <button
                    key={view.id}
                    type="button"
                    onClick={() => handleViewSelect(view.id)}
                    disabled={isViewSelectorDisabled}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                      selectedViewId === view.id
                        ? "border-ui-border-strong bg-ui-bg-subtle text-ui-fg-base"
                        : "border-transparent bg-ui-bg-base text-ui-fg-subtle hover:text-ui-fg-base"
                    }`}
                  >
                    {view.name}
                  </button>
                ))}
                {hasConfigurationChanged && (
                  <Badge size="2xsmall" color="orange">
                    Unsaved changes
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex flex-col sm:flex-row w-full md:w-auto gap-y-2 gap-x-2">
              <div className="w-full sm:max-w-[260px] md:w-auto">
                <DataTable.Search placeholder="Search inventory orders..." />
              </div>
              <div className="flex items-center gap-x-2">
                <Button
                  size="small"
                  variant="secondary"
                  onClick={() => navigate("/inventory/import-from-image")}
                >
                  Import inventory
                </Button>
                <Button
                  size="small"
                  variant="secondary"
                  onClick={() => navigate("/chats?entity=inventory_order")}
                >
                  CreateAI
                </Button>
                <CreateButton />
              </div>
            </div>
          </DataTable.Toolbar>

          <DataTable.Table />
          <DataTable.Pagination />
        </DataTable>
      </Container>
      <Outlet />
      {isSaveDialogOpen && (
        <SaveViewDialog
          entity="inventory_orders"
          currentConfiguration={currentConfiguration}
          editingView={editingView}
          onClose={handleDialogClose}
          onSaved={handleViewSaved}
        />
      )}
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
