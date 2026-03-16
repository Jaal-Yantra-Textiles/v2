import { createDataTableColumnHelper, Badge } from "@medusajs/ui"
import { Container, Heading, Text, Button } from "@medusajs/ui"
import { PlusMini } from "@medusajs/icons"
import { keepPreviousData } from "@tanstack/react-query"
import { useMemo } from "react"
import { useNavigate } from "react-router-dom"

import { SingleColumnPage } from "../../../components/layout/pages"
import { Filter } from "../../../components/table/data-table"
import { _DataTable } from "../../../components/table/data-table/data-table"
import { useDataTable } from "../../../hooks/use-data-table"
import { useQueryParams } from "../../../hooks/use-query-params"
import {
  usePartnerWebsite,
  useCreatePartnerWebsite,
  useContentPages,
  ContentPage,
} from "../../../hooks/api/content"
import { usePartnerStores } from "../../../hooks/api/partner-stores"
import { useStorefrontStatus } from "../../../hooks/api/storefront"
import { toast } from "@medusajs/ui"

const columnHelper = createDataTableColumnHelper<ContentPage>()
const PAGE_SIZE = 20

const STATUS_OPTIONS = [
  { label: "Published", value: "Published" },
  { label: "Draft", value: "Draft" },
  { label: "Archived", value: "Archived" },
]

const PAGE_TYPE_OPTIONS = [
  { label: "Home", value: "Home" },
  { label: "About", value: "About" },
  { label: "Contact", value: "Contact" },
  { label: "Custom", value: "Custom" },
  { label: "Service", value: "Service" },
  { label: "Portfolio", value: "Portfolio" },
  { label: "Landing", value: "Landing" },
]

export const ContentList = () => {
  const navigate = useNavigate()

  // Store & storefront checks
  const { stores, isPending: storesLoading } = usePartnerStores()
  const hasStore = stores.length > 0

  const { data: storefrontStatus, isPending: statusLoading } =
    useStorefrontStatus({ enabled: hasStore })
  const isProvisioned = !!storefrontStatus?.provisioned
  const storefrontDomain = storefrontStatus?.domain

  const { website, isPending: websiteLoading } = usePartnerWebsite({
    enabled: isProvisioned,
  })

  // Query params for table
  const raw = useQueryParams(["offset", "q", "status", "page_type", "order"])
  const offset = raw.offset ? Number(raw.offset) : 0
  const statusFilter = raw.status?.trim() || ""
  const pageTypeFilter = raw.page_type?.trim() || ""
  const q = raw.q?.trim() || ""
  const order = raw.order?.trim() || ""

  // Fetch pages
  const {
    pages,
    count = 0,
    isPending: pagesLoading,
    isError,
    error,
  } = useContentPages(
    {
      limit: PAGE_SIZE,
      offset,
      status: statusFilter || undefined,
    },
    {
      enabled: !!website,
      placeholderData: keepPreviousData,
    }
  )

  // Filter: exclude Blog, apply client-side search & page_type filter
  const filteredData = useMemo(() => {
    const text = q.toLowerCase()
    let data = (pages || []).filter((p) => {
      if (p.page_type === "Blog") return false
      if (pageTypeFilter && p.page_type !== pageTypeFilter) return false
      if (!text) return true
      return (
        (p.title || "").toLowerCase().includes(text) ||
        (p.slug || "").toLowerCase().includes(text)
      )
    })

    if (order) {
      const desc = order.startsWith("-")
      const key = (desc ? order.slice(1) : order) as keyof ContentPage
      data = [...data].sort((a, b) => {
        const av = String((a as any)?.[key] ?? "")
        const bv = String((b as any)?.[key] ?? "")
        const cmp = av.localeCompare(bv)
        return desc ? -cmp : cmp
      })
    }

    return data
  }, [pages, q, pageTypeFilter, order])

  const { mutateAsync: createWebsite, isPending: isCreating } =
    useCreatePartnerWebsite()

  const handleCreatePages = async () => {
    try {
      await createWebsite()
      toast.success("Pages created successfully")
    } catch (e: any) {
      toast.error(e?.message || "Failed to create pages")
    }
  }

  // Columns
  const columns = useMemo(
    () => [
      columnHelper.accessor("title", {
        header: () => "Title",
        cell: ({ getValue }) => getValue() || "-",
      }),
      columnHelper.accessor("slug", {
        header: () => "Slug",
        cell: ({ getValue }) => `/${getValue()}`,
      }),
      columnHelper.accessor("page_type", {
        header: () => "Type",
        cell: ({ getValue }) => (
          <Badge color="grey" size="2xsmall">
            {getValue()}
          </Badge>
        ),
      }),
      columnHelper.accessor("status", {
        header: () => "Status",
        cell: ({ getValue }) => {
          const status = getValue()
          const color =
            status === "Published"
              ? "green"
              : status === "Draft"
                ? "orange"
                : "grey"
          return (
            <Badge color={color} size="2xsmall">
              {status}
            </Badge>
          )
        },
      }),
    ],
    []
  )

  const filters = useMemo<Filter[]>(
    () => [
      {
        type: "select",
        key: "status",
        label: "Status",
        options: STATUS_OPTIONS,
      },
      {
        type: "select",
        key: "page_type",
        label: "Type",
        options: PAGE_TYPE_OPTIONS,
      },
    ],
    []
  )

  const { table } = useDataTable({
    data: filteredData,
    columns,
    enablePagination: true,
    count: filteredData.length,
    pageSize: PAGE_SIZE,
  })

  const isLoading = storesLoading || statusLoading

  // No store
  if (!isLoading && !hasStore) {
    return (
      <div className="flex flex-col gap-y-3">
        <Container className="p-8 text-center">
          <Heading level="h1" className="mb-2">Content</Heading>
          <Text className="text-ui-fg-subtle mb-6">
            Create a store first to manage your storefront content.
          </Text>
          <Button onClick={() => navigate("/create-store")}>Create Store</Button>
        </Container>
      </div>
    )
  }

  // Not provisioned
  if (!isLoading && !statusLoading && !isProvisioned) {
    return (
      <div className="flex flex-col gap-y-3">
        <Container className="p-8 text-center">
          <Heading level="h1" className="mb-2">Content</Heading>
          <Text className="text-ui-fg-subtle mb-6">
            Enable your storefront to start managing pages.
          </Text>
          <Button onClick={() => navigate("/settings/store")}>Enable Storefront</Button>
        </Container>
      </div>
    )
  }

  // Provisioned but no website
  if (!isLoading && !websiteLoading && !website) {
    return (
      <div className="flex flex-col gap-y-3">
        <Container className="p-8 text-center">
          <Heading level="h1" className="mb-2">Content</Heading>
          <Text className="text-ui-fg-subtle mb-4">
            Your storefront is live at{" "}
            <span className="font-medium text-ui-fg-base">{storefrontDomain}</span>
          </Text>
          <Text className="text-ui-fg-subtle mb-6">
            Create your default pages (Terms & Conditions, Privacy Policy, Contact) to get started.
          </Text>
          <Button onClick={handleCreatePages} disabled={isCreating}>
            <PlusMini className="mr-1.5" />
            {isCreating ? "Creating..." : "Create Pages"}
          </Button>
        </Container>
      </div>
    )
  }

  if (isError) {
    throw error
  }

  // Pages table
  return (
    <SingleColumnPage
      widgets={{ before: [], after: [] }}
      hasOutlet={true}
    >
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <Heading>Content</Heading>
            {storefrontDomain && (
              <Text size="small" className="text-ui-fg-subtle">{storefrontDomain}</Text>
            )}
          </div>
        </div>
        <_DataTable
          columns={columns}
          table={table}
          pagination
          navigateTo={(row) => `/content/${row.original.id}`}
          count={filteredData.length}
          isLoading={pagesLoading || websiteLoading}
          pageSize={PAGE_SIZE}
          filters={filters}
          orderBy={[
            { key: "title", label: "Title" },
            { key: "slug", label: "Slug" },
            { key: "status", label: "Status" },
          ]}
          search
          queryObject={raw}
          noRecords={{
            message: "No pages found",
          }}
        />
      </Container>
    </SingleColumnPage>
  )
}
