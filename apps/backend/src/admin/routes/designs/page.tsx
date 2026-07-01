import {
  Container,
  Heading,
  Text,
  DataTable,
  useDataTable,
  createDataTableFilterHelper,
  createDataTableColumnHelper,
  DataTablePaginationState,
  DataTableFilteringState,
  DataTableRowSelectionState,
  Button,
  Badge,
  toast,
  CommandBar,
  Tooltip,
} from "@medusajs/ui";
import { Outlet, useNavigate, useSearchParams } from "react-router-dom";
import { keepPreviousData } from "@tanstack/react-query";
import { PencilSquare, Eye } from "@medusajs/icons";
import CreateButton from "../../components/creates/create-button";
import { RecreateForProductionDrawer } from "../../components/designs/recreate-for-production-drawer";
import { BulkLinkPartnerDrawer } from "../../components/designs/bulk-link-partner-drawer";
import { BulkUpdateStatusDrawer } from "../../components/designs/bulk-update-status-drawer";
import { BulkAssignTagsDrawer } from "../../components/designs/bulk-assign-tags-drawer";
import { BulkDeleteDialog } from "../../components/designs/bulk-delete-dialog";
import { SendToProductionDrawer } from "../../components/designs/send-to-production-drawer";
import { useMemo, useState, useCallback, useEffect, Fragment } from "react";
import { EntityActions } from "../../components/persons/personsActions";
import { AdminDesign, useDesigns } from "../../hooks/api/designs";
import { useDesignsTableColumns } from "../../hooks/columns/useDesignsTableColumns";
import { AdminDesignsQuery } from "../../hooks/api/designs";
import debounce from "lodash/debounce";
import isEqual from "lodash/isEqual";
import { SaveViewDialog } from "../../components/views/save-view-dialog";
import { useViewConfigurationActions } from "../../hooks/use-view-configurations";
import type { ViewConfiguration } from "../../hooks/api/views";
import { usePartners } from "../../hooks/api/partners";
import { sdk } from "../../lib/config";
import { DesignOrderPreviewDrawer } from "../../components/designs/design-order-preview-drawer";
import type {
  PreviewDesignOrderResponse,
  CreateDesignOrderResponse,
} from "../../hooks/api/designs";
const columnHelper = createDataTableColumnHelper<AdminDesign>();

// Plain command descriptors — the compact CommandBar below renders them (letter
// badge + hover tooltip) and CommandBar.Command owns the keyboard shortcut, so
// there's no need for the DataTable command helper / its (ctx) => action shape.
type DesignCommand = { label: string; shortcut: string; action: () => void };

const useCommands = (callbacks: {
  onCreateOrder: () => void
  onSendToProduction: () => void
  onProductionRun: () => void
  onRecreate: () => void
  onEdit: () => void
  onLinkPartner: () => void
  onAssignTags: () => void
  onUpdateStatus: () => void
  onDelete: () => void
  onRevise: () => void
}): DesignCommand[] => {
  return [
    // #826 S1 — collate the selected designs into ONE customer order.
    { label: "Create Order", shortcut: "o", action: callbacks.onCreateOrder },
    // #826 — collate the selected designs into ONE partner work-order with NO
    // customer/sale (the "just make these" path).
    {
      label: "Send to Production",
      shortcut: "g",
      action: callbacks.onSendToProduction,
    },
    {
      label: "Run Production Run",
      shortcut: "p",
      action: callbacks.onProductionRun,
    },
    {
      label: "Re-Create for Production",
      shortcut: "r",
      action: callbacks.onRecreate,
    },
    { label: "Edit Design", shortcut: "e", action: callbacks.onEdit },
    { label: "Link to Partner", shortcut: "l", action: callbacks.onLinkPartner },
    { label: "Assign Tags", shortcut: "t", action: callbacks.onAssignTags },
    { label: "Update Status", shortcut: "s", action: callbacks.onUpdateStatus },
    { label: "Delete", shortcut: "d", action: callbacks.onDelete },
    { label: "Revise Design", shortcut: "v", action: callbacks.onRevise },
  ];
};

export const useColumns = () => {
  const columns = useDesignsTableColumns();

  const designActionsConfig = {
    actions: [
      {
        icon: <Eye />,
        label: "Preview",
        to: (design: AdminDesign) => `/designs/preview/${design.id}`,
      },
      {
        icon: <PencilSquare />,
        label: "Edit",
        to: (design: AdminDesign) => `/designs/${design.id}/edit`,
      },
    ],
  };

  return useMemo(
    () => [
      columnHelper.select(),
      ...columns,
      columnHelper.display({
        id: "actions",
        cell: ({ row }) => (
          <EntityActions
            entity={row.original}
            actionsConfig={designActionsConfig}
          />
        ),
      }),
    ],
    [columns],
  );
};

const DesignsPage = () => {
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
  const [sorting, setSorting] = useState<{ id: string; desc: boolean } | null>(null);

  const [rowSelection, setRowSelection] = useState<DataTableRowSelectionState>({});
  const [isRecreateDrawerOpen, setIsRecreateDrawerOpen] = useState(false);
  const [isLinkPartnerOpen, setIsLinkPartnerOpen] = useState(false);
  const [isUpdateStatusOpen, setIsUpdateStatusOpen] = useState(false);
  const [isAssignTagsOpen, setIsAssignTagsOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isSendToProductionOpen, setIsSendToProductionOpen] = useState(false);
  // #826 S1 — collated "Create Order" from the general Designs list.
  const [orderCustomerId, setOrderCustomerId] = useState<string | null>(null);
  const [orderDesignIds, setOrderDesignIds] = useState<string[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewDesignOrderResponse | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isCreatingOrder, setIsCreatingOrder] = useState(false);

  const {
    listViews,
    activeView,
    setActiveView,
  } = useViewConfigurationActions("designs");
  const views = listViews.data?.view_configurations || [];
  const currentActiveView = activeView.data?.view_configuration || null;

  // Debounced filter change handler to prevent rapid re-renders and API calls
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
  
  // Calculate the offset based on pagination
  const offset = pagination.pageIndex * pagination.pageSize;
  
  const {
    designs, 
    count,
    isLoading,
    isError,
    error,
  } = useDesigns(
    {
      limit: pagination.pageSize,
      offset: offset,
      name: search || undefined, // Use name instead of q for search
      ...(sorting?.id
        ? { order: `${sorting.id}:${sorting.desc ? "DESC" : "ASC"}` }
        : {}),
      // Apply filtering only for known fields
      ...(Object.keys(filtering).length > 0
        ? Object.entries(filtering).reduce((acc, [key, value]) => {
            if (key === "design_type") {
              acc.design_type = value as AdminDesign["design_type"];
            } else if (key === "status") {
              acc.status = value as AdminDesign["status"];
            } else if (key === "priority") {
              acc.priority = value as AdminDesign["priority"];
            } else if (key === "tags") {
              acc.tags = Array.isArray(value) ? value : [value as string];
            } else if (key === "partner_id") {
              const partnerValue = Array.isArray(value) ? value[0] : value;
              if (partnerValue) {
                acc.partner_id = partnerValue as string;
              }
            } else if (key === "created_at" || key === "target_completion_date") {
              const parsedValue =
                typeof value === "string" ? JSON.parse(value) : value;
              if (parsedValue) {
                acc[key] = parsedValue as AdminDesignsQuery["created_at"];
              }
            }
            return acc;
          }, {} as AdminDesignsQuery)
        : {}),
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

  const filterHelper = createDataTableFilterHelper<AdminDesign>();

  // Create filters using the filterHelper
  const dateFilterOptions = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const daysAgo = (days: number) => {
      const date = new Date(startOfToday);
      date.setDate(date.getDate() - days);
      return date.toISOString();
    };

    const daysAhead = (days: number) => {
      const date = new Date(endOfToday);
      date.setDate(date.getDate() + days);
      return date.toISOString();
    };

    return [
      {
        label: "Today",
        value: {
          $gte: startOfToday.toISOString(),
          $lte: endOfToday.toISOString(),
        },
      },
      {
        label: "Last 7 days",
        value: {
          $gte: daysAgo(7),
        },
      },
      {
        label: "Last 30 days",
        value: {
          $gte: daysAgo(30),
        },
      },
      {
        label: "Last 90 days",
        value: {
          $gte: daysAgo(90),
        },
      },
      {
        label: "Next 7 days",
        value: {
          $lte: daysAhead(7),
        },
      },
      {
        label: "Next 30 days",
        value: {
          $lte: daysAhead(30),
        },
      },
    ];
  }, []);

  const filters = [
    filterHelper.accessor("design_type", {
      type: "select",
      label: "Design Type",
      options: [
        { label: "Original", value: "Original" },
        { label: "Derivative", value: "Derivative" },
        { label: "Custom", value: "Custom" },
        { label: "Collaboration", value: "Collaboration" },
      ],
    }),
    filterHelper.accessor("status", {
      type: "select",
      label: "Status",
      options: [
        { label: "Conceptual", value: "Conceptual" },
        { label: "In Development", value: "In_Development" },
        { label: "Technical Review", value: "Technical_Review" },
        { label: "Sample Production", value: "Sample_Production" },
        { label: "Revision", value: "Revision" },
        { label: "Approved", value: "Approved" },
        { label: "Commerce Ready", value: "Commerce_Ready" },
        { label: "Rejected", value: "Rejected" },
        { label: "On Hold", value: "On_Hold" },
      ],
    }),
    filterHelper.accessor("priority", {
      type: "select",
      label: "Priority",
      options: [
        { label: "Low", value: "Low" },
        { label: "Medium", value: "Medium" },
        { label: "High", value: "High" },
        { label: "Urgent", value: "Urgent" },
      ],
    }),
    filterHelper.accessor("tags", {
      type: "select",
      label: "Tags",
      options: useMemo(() => {
        if (!designs?.length) return [];
        
        // Extract all tags from all designs
        const allTags = designs.reduce((acc: string[], design) => {
          if (design.tags?.length) {
            return [...acc, ...design.tags];
          }
          return acc;
        }, []);
        
        // Create unique tag list
        const uniqueTags = [...new Set(allTags)];
        
        // Convert to options format
        return uniqueTags.map(tag => ({
          label: tag,
          value: tag
        }));
      }, [designs]),
    }),
    filterHelper.accessor("partner_id", {
      type: "select",
      label: "Partner",
      options: partnerFilterOptions,
    }),
    filterHelper.accessor("created_at", {
      type: "date",
      label: "Created date",
      options: dateFilterOptions,
    }),
    filterHelper.accessor("target_completion_date", {
      type: "date",
      label: "Target date",
      options: dateFilterOptions,
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
          next.set("name", searchValue);
        } else {
          next.delete("name");
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

  const commands = useCommands({
    onCreateOrder: () => handleCreateOrder(),
    onSendToProduction: () => setIsSendToProductionOpen(true),
    onProductionRun: () => {
      if (selectedDesignIds.length === 1) {
        navigate(`/designs/${selectedDesignIds[0]}/production-run`)
      }
    },
    onRecreate: () => setIsRecreateDrawerOpen(true),
    onEdit: () => {
      if (selectedDesignIds.length === 1) {
        navigate(`/designs/${selectedDesignIds[0]}/edit`)
      }
    },
    onLinkPartner: () => setIsLinkPartnerOpen(true),
    onAssignTags: () => setIsAssignTagsOpen(true),
    onUpdateStatus: () => setIsUpdateStatusOpen(true),
    onDelete: () => setIsDeleteDialogOpen(true),
    onRevise: () => {
      if (selectedDesignIds.length === 1) {
        navigate(`/designs/${selectedDesignIds[0]}/revise`)
      }
    },
  });

  const selectedDesignIds = Object.keys(rowSelection).filter((k) => rowSelection[k]);
  const selectedDesigns = useMemo(
    () => (designs ?? []).filter((d) => selectedDesignIds.includes(d.id)),
    [designs, selectedDesignIds]
  );

  const table = useDataTable({
    columns,
    data: designs ?? [],
    getRowId: (row) => row.id as string,
    onRowClick: (_, row) => {
      navigate(`/designs/${row.id}`);
    },
    rowCount: count,
    isLoading,
    filters,
    // NOTE: commands are rendered by the custom compact CommandBar below (letter
    // badge + hover tooltip); it owns the keyboard shortcuts, so they are NOT
    // passed here to avoid double registration.
    rowSelection: {
      state: rowSelection,
      onRowSelectionChange: setRowSelection,
    },
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
    sorting: {
      state: sorting,
      onSortingChange: setSorting,
    },
  });

  const clearSelection = () => setRowSelection({});

  // #826 S1 — collate the selected designs into ONE customer order.
  // Option A: the order is the commissioning order; per-design production runs
  // stay per-design downstream. Resolves the customer from the selected
  // designs' customer link (enriched onto the list response); requires a single
  // shared customer for now (picker fallback deferred).
  const handleCreateOrder = async () => {
    if (selectedDesigns.length === 0 || isPreviewing) return;

    const customerIds = Array.from(
      new Set(
        selectedDesigns
          .map((d) => (d as any).customer_id)
          .filter((id): id is string => Boolean(id))
      )
    );

    if (customerIds.length === 0) {
      toast.error("No customer linked", {
        description:
          "The selected designs aren't linked to a customer. Link a customer first, then create the order.",
      });
      return;
    }
    if (customerIds.length > 1) {
      toast.error("Multiple customers selected", {
        description:
          "An order collates designs for a single customer. Select designs that all belong to the same customer.",
      });
      return;
    }

    const customerId = customerIds[0];
    const designIds = selectedDesigns.map((d) => d.id as string);

    setOrderCustomerId(customerId);
    setOrderDesignIds(designIds);
    setIsPreviewing(true);
    try {
      const preview = await sdk.client.fetch<PreviewDesignOrderResponse>(
        `/admin/customers/${customerId}/design-order/preview`,
        { method: "POST", body: { design_ids: designIds } }
      );
      setPreviewData(preview);
      setPreviewOpen(true);
    } catch (err: any) {
      toast.error("Failed to estimate order", {
        description: err?.message || "An unexpected error occurred.",
      });
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleConfirmOrder = async (
    priceOverrides: Record<string, number>,
    overrideCurrency?: string
  ) => {
    if (!orderCustomerId || orderDesignIds.length === 0) return;
    setIsCreatingOrder(true);
    try {
      await sdk.client.fetch<CreateDesignOrderResponse>(
        `/admin/customers/${orderCustomerId}/design-order`,
        {
          method: "POST",
          body: {
            design_ids: orderDesignIds,
            price_overrides:
              Object.keys(priceOverrides).length > 0 ? priceOverrides : undefined,
            override_currency: overrideCurrency,
          },
        }
      );
      setPreviewOpen(false);
      setPreviewData(null);
      clearSelection();
      toast.success("Checkout cart created", {
        description:
          "Share the checkout link with the customer to complete payment.",
      });
    } catch (err: any) {
      toast.error("Failed to create order", {
        description: err?.message || "An unexpected error occurred.",
      });
    } finally {
      setIsCreatingOrder(false);
    }
  };

  if (isError) {
    throw error;
  }

  return (
    <div>
    <Container className="divide-y p-0">
      <DataTable key={tableUiResetKey} instance={table} >
        <DataTable.Toolbar
          filterBarContent={filterBarContent}
          className="flex flex-col md:flex-row justify-between gap-y-4 px-6 py-4"
        >
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <Heading>Designs</Heading>
              <Text className="text-ui-fg-subtle" size="small">
                Manage all your designs from here
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
              <DataTable.Search placeholder="Search designs..." />
            </div>
            <div className="flex items-center gap-x-2">
              <CreateButton />
            </div>
          </div>
        </DataTable.Toolbar>
        
        <DataTable.Table />
        <DataTable.Pagination />
      </DataTable>
      {/* #826 — compact command bar: each action is just its shortcut letter;
          hover reveals the full label. Owns its own keyboard shortcuts (the
          DataTable's `commands` were removed to avoid double registration). */}
      <CommandBar open={selectedDesignIds.length > 0}>
        <CommandBar.Bar>
          <CommandBar.Value>
            {selectedDesignIds.length} selected
          </CommandBar.Value>
          {commands.map((cmd) => (
            <Fragment key={cmd.shortcut}>
              <CommandBar.Seperator />
              <Tooltip content={cmd.label}>
                <CommandBar.Command
                  label=""
                  shortcut={cmd.shortcut}
                  action={cmd.action}
                />
              </Tooltip>
            </Fragment>
          ))}
        </CommandBar.Bar>
      </CommandBar>
    </Container>
    <Outlet></Outlet>
    {isSaveDialogOpen && (
      <SaveViewDialog
        entity="designs"
        currentConfiguration={currentConfiguration}
        editingView={editingView}
        onClose={handleDialogClose}
        onSaved={handleViewSaved}
      />
    )}

    {previewData && (
      <DesignOrderPreviewDrawer
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        estimates={previewData.estimates}
        currencyCode={previewData.currency_code}
        total={previewData.total}
        onConfirm={handleConfirmOrder}
        isConfirming={isCreatingOrder}
      />
    )}

    {selectedDesigns.length > 0 && (
      <>
        <RecreateForProductionDrawer
          open={isRecreateDrawerOpen}
          onOpenChange={setIsRecreateDrawerOpen}
          selectedDesigns={selectedDesigns}
          onComplete={clearSelection}
        />
        <BulkLinkPartnerDrawer
          open={isLinkPartnerOpen}
          onOpenChange={setIsLinkPartnerOpen}
          selectedDesigns={selectedDesigns}
          onComplete={clearSelection}
        />
        <BulkUpdateStatusDrawer
          open={isUpdateStatusOpen}
          onOpenChange={setIsUpdateStatusOpen}
          selectedDesigns={selectedDesigns}
          onComplete={clearSelection}
        />
        <BulkAssignTagsDrawer
          open={isAssignTagsOpen}
          onOpenChange={setIsAssignTagsOpen}
          selectedDesigns={selectedDesigns}
          onComplete={clearSelection}
        />
        <BulkDeleteDialog
          open={isDeleteDialogOpen}
          onOpenChange={setIsDeleteDialogOpen}
          selectedDesigns={selectedDesigns}
          onComplete={clearSelection}
        />
        <SendToProductionDrawer
          open={isSendToProductionOpen}
          onOpenChange={setIsSendToProductionOpen}
          selectedDesigns={selectedDesigns}
          onComplete={clearSelection}
        />
      </>
    )}
    </div>
  );
};

export default DesignsPage;

// Sidebar entry removed — reached via /admin/production hub. URL still works.


export const handle = {
  breadcrumb: () => "Designs",
};