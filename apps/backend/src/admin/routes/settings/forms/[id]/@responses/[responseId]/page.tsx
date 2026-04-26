import {
  Container,
  Heading,
  Text,
  DataTable,
  useDataTable,
  DataTablePaginationState,
} from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import { useParams } from "react-router-dom"
import { useMemo, useState } from "react"
import { createColumnHelper } from "@tanstack/react-table"
import { RouteDrawer } from "../../../../../../components/modal/route-drawer/route-drawer"
import { useFormResponse } from "../../../../../../hooks/api/forms"

type KVRow = {
  id: string
  key: string
  value: string
}

const columnHelper = createColumnHelper<KVRow>()

const formatValue = (value: any) => {
  if (value === null) {
    return "null"
  }

  if (value === undefined) {
    return "-"
  }

  if (typeof value === "string") {
    return value
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

const flattenObject = (obj: any, prefix: string): Array<{ key: string; value: any }> => {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return []
  }

  return Object.entries(obj).flatMap(([k, v]) => {
    const fullKey = `${prefix}.${k}`
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return flattenObject(v, fullKey)
    }
    return [{ key: fullKey, value: v }]
  })
}

export default function FormResponseDetailPage() {
  const { id, responseId } = useParams()
  const { t } = useTranslation()

  const { response, isLoading, isError, error } = useFormResponse(id!, responseId!)

  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageSize: 50,
    pageIndex: 0,
  })

  const rows = useMemo((): KVRow[] => {
    if (!response) {
      return []
    }

    const base: Array<{ key: string; value: any }> = [
      { key: "id", value: (response as any).id },
      { key: "email", value: (response as any).email },
      { key: "status", value: (response as any).status },
      { key: "submitted_at", value: (response as any).submitted_at },
      { key: "page_url", value: (response as any).page_url },
      { key: "referrer", value: (response as any).referrer },
      { key: "ip", value: (response as any).ip },
      { key: "user_agent", value: (response as any).user_agent },
      { key: "created_at", value: (response as any).created_at },
      { key: "updated_at", value: (response as any).updated_at },
    ]

    const dataRows = flattenObject((response as any).data, "data")
    const metadataRows = flattenObject((response as any).metadata, "metadata")

    const all = [...base, ...dataRows, ...metadataRows]
      .filter((r) => r.value !== undefined)
      .map((r) => ({
        id: r.key,
        key: r.key,
        value: formatValue(r.value),
      }))

    return all
  }, [response])

  const columns = useMemo(
    () => [
      columnHelper.accessor("key", {
        header: t("Key"),
        cell: ({ getValue }) => <Text size="small">{getValue()}</Text>,
      }),
      columnHelper.accessor("value", {
        header: t("Value"),
        cell: ({ getValue }) => (
          <Text
            size="small"
            className="whitespace-pre-wrap break-words font-mono"
          >
            {getValue() || "-"}
          </Text>
        ),
      }),
    ],
    [t]
  )

  const table = useDataTable({
    columns,
    data: rows,
    getRowId: (row) => row.id,
    rowCount: rows.length,
    isLoading,
    pagination: {
      state: pagination,
      onPaginationChange: setPagination,
    },
  })

  if (isLoading) {
    return (
      <RouteDrawer>
        <Container className="p-0">
          <div className="px-6 py-4 border-b">
            <Heading level="h2">{t("Loading response...")}</Heading>
          </div>
          <div className="p-6">
            <Text className="text-ui-fg-subtle">{t("Please wait while we load the response details...")}</Text>
          </div>
        </Container>
      </RouteDrawer>
    )
  }

  if (isError || !response) {
    return (
      <RouteDrawer>
        <Container className="p-0">
          <div className="px-6 py-4 border-b">
            <Heading level="h2">{t("Error")}</Heading>
          </div>
          <div className="p-6">
            <Text className="text-ui-fg-subtle">{(error as any)?.message || t("Response not found")}</Text>
          </div>
        </Container>
      </RouteDrawer>
    )
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <RouteDrawer.Title asChild>
          <Heading>{t("Response")}</Heading>
        </RouteDrawer.Title>
        <RouteDrawer.Description className="sr-only">
          {t("Form response detail")}
        </RouteDrawer.Description>
      </RouteDrawer.Header>

      <RouteDrawer.Body className="p-0 max-h-[calc(100vh-80px)] overflow-y-auto">
        <Container className="p-0">
          <DataTable instance={table}>
            <DataTable.Table />
            <DataTable.Pagination />
          </DataTable>
        </Container>
      </RouteDrawer.Body>
    </RouteDrawer>
  )
}
