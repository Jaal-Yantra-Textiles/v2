import { Button, Container, DataTable, DataTablePaginationState, DataTableFilteringState, Drawer, Heading, StatusBadge, Text, useDataTable, createDataTableFilterHelper } from "@medusajs/ui"
import { useSocialPlatforms } from "../../../hooks/api/social-platforms"
import { useSocialPlatformTableColumns } from "./hooks/use-social-platform-table-columns"
import { useNavigate } from "react-router-dom"
import { AdminSocialPlatform } from "../../../hooks/api/social-platforms"
import { useGoogleMerchantAccounts } from "../../../hooks/api/google-merchant"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { FolderIllustration } from "@medusajs/icons"
import { useCallback, useMemo, useState } from "react"
import debounce from "lodash/debounce"
import { GOOGLE_MERCHANT_VIRTUAL_ID } from "./constants"

const PAGE_SIZE = 10

const SocialPlatformPage = () => {
  const navigate = useNavigate()
  const [pagination, setPagination] = useState<DataTablePaginationState>({ 
    pageIndex: 0, 
    pageSize: PAGE_SIZE 
  })
  const [search, setSearch] = useState("")
  const [filtering, setFiltering] = useState<DataTableFilteringState>({})
  const [sorting, setSorting] = useState<{ id: string; desc: boolean } | null>(null)
  const [googleDrawerOpen, setGoogleDrawerOpen] = useState(false)

  const offset = pagination.pageIndex * pagination.pageSize

  const { accounts: googleAccounts, count: googleAccountsCount, isLoading: googleAccountsLoading } = useGoogleMerchantAccounts({ limit: 50 })
  const googleConnected = googleAccounts.some((a) => a.connected)

  const orderParam = sorting?.id
    ? `${sorting.id}:${sorting.desc ? "DESC" : "ASC"}`
    : undefined

  const { socialPlatforms, count, isLoading, isError, error } = useSocialPlatforms({
    limit: pagination.pageSize,
    offset,
    q: search || undefined,
    ...(orderParam ? { order: orderParam } : {}),
    // Apply filtering - transform filter values to match API expectations
    ...(Object.keys(filtering).length > 0 ? 
      Object.entries(filtering).reduce((acc, [key, value]) => {
        // If value is an array, take the first element, otherwise use the value as-is
        acc[key] = Array.isArray(value) ? value[0] : value;
        return acc;
      }, {} as any) : {}),
  })

  const hasActiveFilters = Object.keys(filtering).length > 0 || !!search
  const showGoogleMerchantRow = pagination.pageIndex === 0 && !hasActiveFilters

  const tableData = useMemo<AdminSocialPlatform[]>(() => {
    const base = (socialPlatforms || []) as AdminSocialPlatform[]
    if (!showGoogleMerchantRow) return base
    const virtual: AdminSocialPlatform = {
      id: GOOGLE_MERCHANT_VIRTUAL_ID,
      name: "Google Merchant Center",
      category: "other",
      auth_type: "oauth2",
      icon_url: null,
      base_url: "https://merchants.google.com",
      description: googleConnected
        ? `${googleAccountsCount} account${googleAccountsCount === 1 ? "" : "s"} · connected`
        : "Sync products to Google Shopping",
      api_config: null,
      status: googleConnected ? "active" : "pending",
      metadata: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null,
    }
    return [virtual, ...base]
  }, [socialPlatforms, showGoogleMerchantRow, googleConnected, googleAccountsCount])

  const columns = useSocialPlatformTableColumns()

  // Create filters using the filterHelper
  const filterHelper = createDataTableFilterHelper<AdminSocialPlatform>()
  
  const filters = [
    filterHelper.accessor("category", {
      type: "select",
      label: "Category",
      options: [
        { label: "Social Media", value: "social" },
        { label: "Payment", value: "payment" },
        { label: "Shipping", value: "shipping" },
        { label: "Email", value: "email" },
        { label: "SMS", value: "sms" },
        { label: "Analytics", value: "analytics" },
        { label: "CRM", value: "crm" },
        { label: "Storage", value: "storage" },
        { label: "Communication", value: "communication" },
        { label: "Authentication", value: "authentication" },
        { label: "Google Business Manager", value: "google" },
        { label: "Other", value: "other" },
      ],
    }),
    filterHelper.accessor("auth_type", {
      type: "select",
      label: "Auth Type",
      options: [
        { label: "OAuth 2.0", value: "oauth2" },
        { label: "OAuth 1.0", value: "oauth1" },
        { label: "API Key", value: "api_key" },
        { label: "Bearer Token", value: "bearer" },
        { label: "Basic Auth", value: "basic" },
      ],
    }),
    filterHelper.accessor("status", {
      type: "select",
      label: "Status",
      options: [
        { label: "Active", value: "active" },
        { label: "Inactive", value: "inactive" },
        { label: "Error", value: "error" },
        { label: "Pending", value: "pending" },
      ],
    }),
  ]

  const handleSearchChange = useCallback(
    debounce((newSearch: string) => {
      setSearch(newSearch);
    }, 300),
    []
  );

  const handleFilterChange = useCallback(
    debounce((newFilters: DataTableFilteringState) => {
      setFiltering(newFilters);
    }, 300),
    []
  );

  const table = useDataTable({
    data: tableData,
    columns: columns,
    rowCount: (count ?? 0) + (showGoogleMerchantRow ? 1 : 0),
    getRowId: (row: AdminSocialPlatform) => row.id,
    onRowClick: (_, row) => {
      if (row.id === GOOGLE_MERCHANT_VIRTUAL_ID) {
        setGoogleDrawerOpen(true)
        return
      }
      navigate(`/settings/external-platforms/${row.id}`);
    },
    isLoading: isLoading,
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
    sorting: {
      state: sorting,
      onSortingChange: setSorting,
    },
  })

  if (isError) {
    throw error
  }

  return (
    <Container className="divide-y p-0">
      <DataTable instance={table}>
        <DataTable.Toolbar className="flex flex-col md:flex-row justify-between gap-y-4 px-6 py-4">
          <div>
            <Heading>External Platforms</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Manage all your external api + social platforms from here
            </Text>
          </div>
          <div className="flex flex-col sm:flex-row w-full md:w-auto gap-y-2 gap-x-2">
            <div className="w-full sm:max-w-[260px] md:w-auto">
              <DataTable.Search placeholder="Search platforms..." />
            </div>
            <div className="flex items-center gap-x-2">
              <DataTable.FilterMenu tooltip="Filter platforms" />
              <Button
                size="small"
                variant="secondary"
                onClick={() => navigate("/settings/external-platforms/create")}
              >
                Create
              </Button>
            </div>
          </div>
        </DataTable.Toolbar>
        <DataTable.Table />
        <DataTable.Pagination />
      </DataTable>

      <Drawer open={googleDrawerOpen} onOpenChange={setGoogleDrawerOpen}>
        <Drawer.Content>
          <Drawer.Header>
            <Drawer.Title>Google Merchant Center</Drawer.Title>
            <Drawer.Description>
              Connect and manage Google Merchant Center accounts for product syncing.
            </Drawer.Description>
          </Drawer.Header>
          <Drawer.Body className="flex flex-col gap-y-4 overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <Text size="small" weight="plus">Accounts</Text>
                <Text size="xsmall" className="text-ui-fg-subtle">
                  {googleAccountsLoading
                    ? "Loading…"
                    : `${googleAccountsCount} account${googleAccountsCount === 1 ? "" : "s"}`}
                </Text>
              </div>
              <Button
                size="small"
                variant="primary"
                onClick={() => {
                  setGoogleDrawerOpen(false)
                  navigate("/settings/google-merchant/create")
                }}
              >
                Add Account
              </Button>
            </div>

            {!googleAccountsLoading && googleAccounts.length === 0 ? (
              <Text size="small" className="text-ui-fg-subtle">
                No Google Merchant accounts yet. Click "Add Account" to connect one.
              </Text>
            ) : (
              <div className="flex flex-col divide-y rounded-md border">
                {googleAccounts.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className="flex items-center justify-between px-3 py-2 text-left hover:bg-ui-bg-subtle-hover"
                    onClick={() => {
                      setGoogleDrawerOpen(false)
                      navigate(`/settings/google-merchant/${a.id}`)
                    }}
                  >
                    <div className="flex flex-col">
                      <Text size="small" weight="plus">{a.name}</Text>
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        ID {a.merchant_id}{a.account_email ? ` · ${a.account_email}` : ""}
                      </Text>
                    </div>
                    <StatusBadge color={a.connected ? "green" : "orange"}>
                      {a.connected ? "Connected" : "Not connected"}
                    </StatusBadge>
                  </button>
                ))}
              </div>
            )}
          </Drawer.Body>
          <Drawer.Footer>
            <Drawer.Close asChild>
              <Button variant="secondary">Back to External Platforms</Button>
            </Drawer.Close>
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer>
    </Container>
  )
}



export const config = defineRouteConfig({
    label: "External Platforms",
    icon: FolderIllustration,
  });
  
  export const handle = {
    breadcrumb: () => "External Platforms",
  };
  
  export default SocialPlatformPage