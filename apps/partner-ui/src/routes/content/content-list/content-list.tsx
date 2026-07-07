import { createDataTableColumnHelper, Badge } from "@medusajs/ui"
import { Container, Heading, Text, Button } from "@medusajs/ui"
import { PlusMini } from "@medusajs/icons"
import { keepPreviousData } from "@tanstack/react-query"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"
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

export const ContentList = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const STATUS_OPTIONS = [
    { label: t("partner.content.statusOptions.published"), value: "Published" },
    { label: t("partner.content.statusOptions.draft"), value: "Draft" },
    { label: t("partner.content.statusOptions.archived"), value: "Archived" },
  ]

  const PAGE_TYPE_OPTIONS = [
    { label: t("partner.content.typeOptions.home"), value: "Home" },
    { label: t("partner.content.typeOptions.about"), value: "About" },
    { label: t("partner.content.typeOptions.contact"), value: "Contact" },
    { label: t("partner.content.typeOptions.custom"), value: "Custom" },
    { label: t("partner.content.typeOptions.service"), value: "Service" },
    { label: t("partner.content.typeOptions.portfolio"), value: "Portfolio" },
    { label: t("partner.content.typeOptions.landing"), value: "Landing" },
  ]

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
      toast.success(t("partner.content.toast.pagesCreated"))
    } catch (e: any) {
      toast.error(e?.message || t("partner.content.toast.createFailed"))
    }
  }

  // Columns
  const columns = useMemo(
    () => [
      columnHelper.accessor("title", {
        header: () => t("partner.content.columns.title"),
        cell: ({ getValue }) => getValue() || "-",
      }),
      columnHelper.accessor("slug", {
        header: () => t("partner.content.columns.slug"),
        cell: ({ getValue }) => `/${getValue()}`,
      }),
      columnHelper.accessor("page_type", {
        header: () => t("partner.content.columns.type"),
        cell: ({ getValue }) => (
          <Badge color="grey" size="2xsmall">
            {getValue()}
          </Badge>
        ),
      }),
      columnHelper.accessor("status", {
        header: () => t("partner.content.columns.status"),
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
    [t]
  )

  const filters = useMemo<Filter[]>(
    () => [
      {
        type: "select",
        key: "status",
        label: t("partner.content.filters.status"),
        options: STATUS_OPTIONS,
      },
      {
        type: "select",
        key: "page_type",
        label: t("partner.content.filters.type"),
        options: PAGE_TYPE_OPTIONS,
      },
    ],
    [t]
  )

  const { table } = useDataTable({
    data: filteredData,
    columns,
    enablePagination: true,
    count: filteredData.length,
    pageSize: PAGE_SIZE,
  })

  const isLoading = storesLoading || statusLoading

  // Determine the no-records message based on store/storefront state
  const noStoreReady = !isLoading && !hasStore
  const notProvisioned = !isLoading && hasStore && !statusLoading && !isProvisioned
  const noWebsite = !isLoading && hasStore && isProvisioned && !websiteLoading && !website

  const noRecordsConfig = noStoreReady
    ? {
        title: t("partner.content.empty.noStoreTitle"),
        message: t("partner.content.empty.noStoreMessage"),
      }
    : notProvisioned
      ? {
          title: t("partner.content.empty.notProvisionedTitle"),
          message: t("partner.content.empty.notProvisionedMessage"),
        }
      : noWebsite
        ? {
            title: t("partner.content.empty.noPagesTitle"),
            message: t("partner.content.empty.noPagesMessage"),
          }
        : { message: t("partner.content.empty.noMatches") }

  if (isError) {
    throw error
  }

  // Action button for the header area
  const headerAction = noWebsite ? (
    <Button size="small" onClick={handleCreatePages} disabled={isCreating}>
      <PlusMini className="mr-1.5" />
      {isCreating ? t("partner.content.actions.creatingPages") : t("partner.content.actions.createPages")}
    </Button>
  ) : noStoreReady ? (
    <Button size="small" onClick={() => navigate("/create-store")}>
      {t("partner.content.actions.createStore")}
    </Button>
  ) : notProvisioned ? (
    <Button size="small" onClick={() => navigate("/settings/store")}>
      {t("partner.content.actions.enableStorefront")}
    </Button>
  ) : null

  // Always render the same table layout
  return (
    <SingleColumnPage
      widgets={{ before: [], after: [] }}
      hasOutlet={true}
    >
      <Container className="divide-y p-0">
        <div className="flex flex-col gap-y-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Heading>{t("partner.content.heading")}</Heading>
            {storefrontDomain && (
              <Text size="small" className="text-ui-fg-subtle">{storefrontDomain}</Text>
            )}
          </div>
          {headerAction && <div>{headerAction}</div>}
        </div>
        <_DataTable
          columns={columns}
          table={table}
          pagination
          navigateTo={(row) => `/content/${row.original.id}`}
          count={filteredData.length}
          isLoading={storesLoading || (hasStore && statusLoading) || (isProvisioned && websiteLoading) || (!!website && pagesLoading)}
          pageSize={PAGE_SIZE}
          filters={filters}
          orderBy={[
            { key: "title", label: t("partner.content.columns.title") },
            { key: "slug", label: t("partner.content.columns.slug") },
            { key: "status", label: t("partner.content.columns.status") },
          ]}
          search
          queryObject={raw}
          noRecords={noRecordsConfig}
        />
      </Container>
    </SingleColumnPage>
  )
}
