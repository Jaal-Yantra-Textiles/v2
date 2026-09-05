import { EllipsisHorizontal } from "@medusajs/icons"
import { Container, Heading, Text, DataTable, useDataTable, createDataTableFilterHelper, createDataTableColumnHelper, DataTablePaginationState, DataTableFilteringState, Button, DropdownMenu, IconButton } from "@medusajs/ui";

// Sort state is a single active sort — `null` means default backend order.
type SortingState = { id: string; desc: boolean } | null
import { Link, Outlet, useNavigate } from "react-router-dom";
import CreateButton from "../../components/creates/create-button";
import { usePersons } from "../../hooks/api/persons";
import { useCensusStates } from "../../hooks/api/census";
import { useMemo, useState, useCallback } from "react";
import { usePersonTableColumns } from "../../hooks/columns/usePersonTableColumns";
import { AdminPerson, AdminWeaver } from "../../hooks/api/personandtype";
import { WeaverRevealCell } from "./components/weaver-reveal-cell";
import debounce from "lodash/debounce";



export const useColumns = () => {
  const columns = usePersonTableColumns();

  return useMemo(
    () => [
      ...columns,
    ],
    [columns],
  );
};

// Person filters (exact-match fields the persons API understands).
const PERSON_FILTER_FIELDS = ["email", "first_name", "last_name", "state"] as const;

// Weaver filters — forwarded to the census reader when weavers are included.
const WEAVER_FILTER_FIELDS = ["district", "gender", "region_state", "education"] as const;

const weaverColumnHelper = createDataTableColumnHelper<AdminWeaver>();

const weaverColumns = [
  weaverColumnHelper.accessor("name", {
    header: "Name",
    cell: ({ getValue }) => (
      <Text size="small">{getValue() || "—"}</Text>
    ),
  }),
  weaverColumnHelper.accessor("district", {
    header: "District",
    cell: ({ getValue }) => (
      <Text size="small" className="text-ui-fg-subtle">{getValue() || "—"}</Text>
    ),
  }),
  weaverColumnHelper.accessor("state", {
    header: "State",
    cell: ({ getValue }) => (
      <Text size="small" className="text-ui-fg-subtle">{getValue() || "—"}</Text>
    ),
  }),
  weaverColumnHelper.accessor("gender", {
    header: "Gender",
    cell: ({ getValue }) => (
      <Text size="small" className="text-ui-fg-subtle">{getValue() || "—"}</Text>
    ),
  }),
  weaverColumnHelper.accessor("village", {
    header: "Village",
    cell: ({ getValue }) => (
      <Text size="small" className="text-ui-fg-subtle">{getValue() || "—"}</Text>
    ),
  }),
  weaverColumnHelper.accessor("education", {
    header: "Education",
    cell: ({ getValue }) => (
      <Text size="small" className="text-ui-fg-subtle">{getValue() || "—"}</Text>
    ),
  }),
  weaverColumnHelper.display({
    id: "reveal",
    header: "",
    cell: ({ row }) => <WeaverRevealCell censusId={row.original.census_id} />,
  }),
];

const PersonsPage = () => {
  const navigate = useNavigate();
  
  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageSize: 10,
    pageIndex: 0,
  });
  const [filtering, setFiltering] = useState<DataTableFilteringState>({});
  const [search, setSearch] = useState<string>("");
  const [includeDeleted, setIncludeDeleted] = useState<boolean>(false);
  const [includeWeavers, setIncludeWeavers] = useState<boolean>(false);
  const [sorting, setSorting] = useState<SortingState>(null);
  
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
  
  // Sort state → backend `order` string. The API parses both
  // "created_at:DESC" and "-created_at" shapes. Weavers are not orderable; the
  // sort is only sent for the DB persons list.
  const orderParam = sorting?.id
    ? `${sorting.id}:${sorting.desc ? "DESC" : "ASC"}`
    : undefined

  // Collapse the DataTable filter state (values can arrive as arrays) into the
  // flat exact-match query params. Person and weaver filters are disjoint key
  // sets, so a single reduction over the active mode is safe.
  const filterParams = useMemo(() => {
    const out: Record<string, string> = {};
    const fields = includeWeavers ? WEAVER_FILTER_FIELDS : PERSON_FILTER_FIELDS;
    for (const field of fields) {
      const v = filtering[field];
      const value = Array.isArray(v) ? v[0] : v;
      if (typeof value === "string" && value !== "") out[field] = value;
    }
    return out;
  }, [filtering, includeWeavers]);

  const {
    persons,
    count,
    weavers,
    weaversCount,
    censusConnected,
    isLoading,
  } = usePersons(
    {
      limit: pagination.pageSize,
      offset: offset,
      q: search || undefined,
      withDeleted: includeDeleted,
      include_weavers: includeWeavers || undefined,
      ...(orderParam ? { order: orderParam } : {}),
      ...filterParams,
    },
    {
      // Use the staleTime option instead of keepPreviousData
      staleTime: 30000,
    },
  );

  const columns = useColumns();

  // Full geographic-state list (from the census aggregates) for the weaver
  // "Region state" filter — every state, not just the few on the current page.
  const { states } = useCensusStates();
  
  const personFilterHelper = createDataTableFilterHelper<AdminPerson>();
  
  // Create filters using the filterHelper
  const personFilters = [
    personFilterHelper.accessor("email", {
      type: "select",
      label: "Email",
      options: useMemo(() => {
        if (!persons?.length) return [];
        
        // Extract unique emails
        const uniqueEmails = [...new Set(persons.map(p => p.email))];
        
        // Convert to options format
        return uniqueEmails.map(email => ({
          label: email || "",
          value: email || ""
        }));
      }, [persons]),
    }),
    personFilterHelper.accessor("first_name", {
      type: "select",
      label: "First Name",
      options: useMemo(() => {
        if (!persons?.length) return [];
        const uniqueFirstNames = [...new Set(persons.map(p => p.first_name))];
        return uniqueFirstNames.map(name => ({
          label: name || "",
          value: name || ""
        }));
      }, [persons]),
    }),
    personFilterHelper.accessor("last_name", {
      type: "select",
      label: "Last Name",
      options: useMemo(() => {
        if (!persons?.length) return [];
        const uniqueLastNames = [...new Set(persons.map(p => p.last_name))];
        return uniqueLastNames.map(name => ({
          label: name || "",
          value: name || ""
        }));
      }, [persons]),
    }),
    personFilterHelper.accessor("state", {
      type: "select",
      label: "State",
      options: [
        { label: "Onboarding", value: "Onboarding" },
        { label: "Onboarding Finished", value: "Onboarding Finished" },
        { label: "Stalled", value: "Stalled" },
        { label: "Conflicted", value: "Conflicted" },
      ],
    }),

  ];

  const weaverFilterHelper = createDataTableFilterHelper<AdminWeaver>();

  // Weaver filters, options derived from the loaded (masked) weaver page.
  const weaverFilters = [
    weaverFilterHelper.accessor("district", {
      type: "select",
      label: "District",
      options: useMemo(() => {
        if (!weavers?.length) return [];
        return [...new Set(weavers.map(w => w.district).filter(Boolean))].map(
          (d) => ({ label: d as string, value: d as string })
        );
      }, [weavers]),
    }),
    weaverFilterHelper.accessor("gender", {
      type: "select",
      label: "Gender",
      options: useMemo(() => {
        if (!weavers?.length) return [];
        return [...new Set(weavers.map(w => w.gender).filter(Boolean))].map(
          (g) => ({ label: g as string, value: g as string })
        );
      }, [weavers]),
    }),
    weaverFilterHelper.accessor("region_state", {
      type: "select",
      label: "Region state",
      options: useMemo(() => {
        if (!states?.length) return [];
        return states.map((s) => ({ label: s.state, value: s.state }));
      }, [states]),
    }),
    weaverFilterHelper.accessor("education", {
      type: "select",
      label: "Education",
      options: useMemo(() => {
        if (!weavers?.length) return [];
        return [...new Set(weavers.map(w => w.education).filter(Boolean))].map(
          (e) => ({ label: e as string, value: e as string })
        );
      }, [weavers]),
    }),
  ];

  // The table renders either DB persons or census weavers, never both at once.
  // (Cast to `any` so the person/weaver column+data unions don't fight the
  // DataTable's generic inference — the two shapes are never rendered together.)
  const tableData = (includeWeavers ? (weavers ?? []) : (persons ?? [])) as any[];
  const tableColumns = (includeWeavers ? weaverColumns : columns) as any;
  const tableRowCount = includeWeavers ? (weaversCount ?? 0) : (count ?? 0);

  const table = useDataTable({
    columns: tableColumns,
    data: tableData,
    getRowId: (row) => String(row.id ?? row.census_id),
    // Persons open the person detail; weavers open the census-record detail.
    onRowClick: includeWeavers
      ? (_, row) => {
          navigate(`/persons/weavers/${row.original.census_id}`);
        }
      : (_, row) => {
          navigate(`/persons/${row.id}`);
        },
    rowCount: tableRowCount,
    isLoading: isLoading ?? false,
    filters: includeWeavers ? weaverFilters : personFilters,
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
    sorting: includeWeavers ? undefined : {
      state: sorting,
      onSortingChange: setSorting,
    },
  });

  return (
    <>
      <Container className="divide-y p-0">
        <DataTable instance={table}>
          {/* Header section with title and create button */}
          <DataTable.Toolbar className="flex justify-between items-center px-6 py-4">
            <div>
              <Heading>Persons</Heading>
              <Text className="text-ui-fg-subtle" size="small">
                {includeWeavers
                  ? "Handloom census weavers (masked records)"
                  : "Manage all your relationships from here"}
              </Text>
            </div>
            <div className="flex items-center justify-center gap-x-2">
                <CreateButton />
                <Button size="small" variant="secondary" asChild>
                  <Link to="import">Import</Link>
                </Button>
                <DropdownMenu>
                  <DropdownMenu.Trigger asChild>
                    <IconButton size="small" variant="transparent">
                      <EllipsisHorizontal />
                    </IconButton>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content>
                    <DropdownMenu.Item asChild>
                      <Link to="map">Show Map View</Link>
                    </DropdownMenu.Item>
                    <DropdownMenu.Item asChild>
                      <Link to="backfill-geocodes">Geocodes Backfill</Link>
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu>
            </div>
          </DataTable.Toolbar>
          
          {/* Search and filter section in its own container with divider */}
          <div className="flex items-start justify-between gap-x-4 px-6 py-4 border-t border-ui-border-base">
            <div className="w-full max-w-[60%] flex items-center gap-x-4">
              <DataTable.FilterMenu tooltip={includeWeavers ? "Filter weavers" : "Filter persons"} />
              <div className="flex items-center gap-x-2">
                <input 
                  type="checkbox" 
                  id="include-deleted" 
                  checked={includeDeleted}
                  onChange={(e) => setIncludeDeleted(e.target.checked)}
                  className="h-4 w-4 rounded border-ui-border-base text-ui-fg-interactive"
                />
                <label htmlFor="include-deleted" className="text-ui-fg-subtle text-sm">
                  Include deleted persons
                </label>
              </div>
              <div className="flex items-center gap-x-2">
                <input 
                  type="checkbox" 
                  id="include-weavers" 
                  checked={includeWeavers}
                  onChange={(e) => {
                    setIncludeWeavers(e.target.checked);
                    setFiltering({});
                  }}
                  className="h-4 w-4 rounded border-ui-border-base text-ui-fg-interactive"
                />
                <label htmlFor="include-weavers" className="text-ui-fg-subtle text-sm">
                  Include weavers
                </label>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-x-2">
              <DataTable.Search placeholder={includeWeavers ? "Search weavers..." : "Search persons..."} />
            </div>
          </div>

          {includeWeavers && censusConnected === false && (
            <div className="px-6 py-3 border-t border-ui-border-base">
              <Text size="small" className="text-ui-fg-subtle">
                Census reader not connected — weaver records are unavailable. The
                service connects once the census P2P core replicates (or a
                CENSUS_READER_URL proxy is configured).
              </Text>
            </div>
          )}
          
          <DataTable.Table />
          <DataTable.Pagination />
        </DataTable>
      </Container>
      <Outlet />
      </>
  );
};

export default PersonsPage;



// Sidebar entry removed — reached via /admin/audience hub. URL still works.


export const handle = {
  breadcrumb: () => "People",
};