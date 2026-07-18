import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Users } from "@medusajs/icons";
import {
  Container,
  Heading,
  Text,
  Badge,
  DataTable,
  useDataTable,
  createDataTableColumnHelper,
  createDataTableFilterHelper,
  DataTablePaginationState,
  DataTableFilteringState,
} from "@medusajs/ui";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { sdk } from "../../lib/config";

// Mirrors the CRM People contract served by GET /admin/crm/people. CRM lives on a
// Hyperbee/Autobase node (#1082), not Postgres — so there is no query.graph here;
// we hit the module's REST surface directly, exactly like the census/reader UIs.
type CrmPerson = {
  id: string;
  first_name: string;
  last_name: string;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  company_id?: string | null;
  created_at?: string;
  updated_at?: string;
};

type ListResponse = {
  crm_people: CrmPerson[];
  count: number;
  limit: number;
  offset: number;
};

// The backend filters on exact matches for these fields (see people/validators.ts).
const FILTER_FIELDS = ["email", "last_name", "company_id"] as const;

const columnHelper = createDataTableColumnHelper<CrmPerson>();
const filterHelper = createDataTableFilterHelper<CrmPerson>();

const CrmPeoplePage = () => {
  const navigate = useNavigate();

  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageSize: 20,
    pageIndex: 0,
  });
  const [filtering, setFiltering] = useState<DataTableFilteringState>({});

  const offset = pagination.pageIndex * pagination.pageSize;

  // Collapse the DataTable filter state (values can arrive as arrays) into the
  // flat exact-match query params the CRM API understands.
  const filterParams = useMemo(() => {
    const out: Record<string, string> = {};
    for (const field of FILTER_FIELDS) {
      const v = filtering[field];
      const value = Array.isArray(v) ? v[0] : v;
      if (typeof value === "string" && value !== "") out[field] = value;
    }
    return out;
  }, [filtering]);

  const { data, isLoading } = useQuery({
    queryKey: ["crm-people", pagination.pageSize, offset, filterParams],
    queryFn: () =>
      sdk.client.fetch<ListResponse>("/admin/crm/people", {
        query: { limit: pagination.pageSize, offset, ...filterParams },
      }),
    staleTime: 30_000,
  });

  const people = data?.crm_people ?? [];

  const columns = useMemo(
    () => [
      columnHelper.accessor("last_name", {
        header: "Name",
        cell: ({ row }) => {
          const p = row.original;
          const name = [p.first_name, p.last_name].filter(Boolean).join(" ");
          return <Text size="small">{name || "—"}</Text>;
        },
      }),
      columnHelper.accessor("email", {
        header: "Email",
        cell: ({ getValue }) => (
          <Text size="small" className="text-ui-fg-subtle">
            {getValue() || "—"}
          </Text>
        ),
      }),
      columnHelper.accessor("title", {
        header: "Title",
        cell: ({ getValue }) => <Text size="small">{getValue() || "—"}</Text>,
      }),
      columnHelper.accessor("company_id", {
        header: "Company",
        cell: ({ getValue }) => {
          const v = getValue();
          return v ? (
            <Badge size="2xsmall">{v}</Badge>
          ) : (
            <Text size="small" className="text-ui-fg-muted">
              —
            </Text>
          );
        },
      }),
    ],
    []
  );

  // Select filters populated from the loaded page — mirrors the persons route.
  const filters = useMemo(
    () => [
      filterHelper.accessor("email", {
        type: "select",
        label: "Email",
        options: [...new Set(people.map((p) => p.email).filter(Boolean))].map(
          (email) => ({ label: email as string, value: email as string })
        ),
      }),
      filterHelper.accessor("last_name", {
        type: "select",
        label: "Last name",
        options: [
          ...new Set(people.map((p) => p.last_name).filter(Boolean)),
        ].map((n) => ({ label: n, value: n })),
      }),
      filterHelper.accessor("company_id", {
        type: "select",
        label: "Company",
        options: [
          ...new Set(people.map((p) => p.company_id).filter(Boolean)),
        ].map((c) => ({ label: c as string, value: c as string })),
      }),
    ],
    [people]
  );

  const table = useDataTable({
    columns,
    data: people,
    getRowId: (row) => row.id,
    rowCount: data?.count ?? 0,
    isLoading,
    filters,
    onRowClick: (_, row) => navigate(`/crm/${row.id}`),
    pagination: { state: pagination, onPaginationChange: setPagination },
    filtering: { state: filtering, onFilteringChange: setFiltering },
  });

  return (
    <Container className="divide-y p-0">
      <DataTable instance={table}>
        <DataTable.Toolbar className="flex flex-col items-start justify-between gap-2 px-6 py-4 md:flex-row md:items-center">
          <div>
            <Heading>CRM · People</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              Contacts on the multi-writer CRM node.
            </Text>
          </div>
          <DataTable.FilterMenu tooltip="Filter people" />
        </DataTable.Toolbar>
        <DataTable.Table />
        <DataTable.Pagination />
      </DataTable>
    </Container>
  );
};

export const config = defineRouteConfig({
  label: "CRM",
  icon: Users,
});

export default CrmPeoplePage;
