import { EllipsisHorizontal } from "@medusajs/icons"
import { Container, Heading, Text, DataTable, useDataTable, createDataTableFilterHelper, createDataTableColumnHelper, DataTablePaginationState, DataTableFilteringState, Button, DropdownMenu, IconButton } from "@medusajs/ui";

// Sort state is a single active sort — `null` means default backend order.
type SortingState = { id: string; desc: boolean } | null
import { Link, Outlet, useNavigate, useSearchParams } from "react-router-dom";
import CreateButton from "../../components/creates/create-button";
import { usePersons } from "../../hooks/api/persons";
import { useCensusStates } from "../../hooks/api/census";
import { useMemo, useCallback } from "react";
import { usePersonTableColumns } from "../../hooks/columns/usePersonTableColumns";
import { AdminPerson, AdminWeaver } from "../../hooks/api/personandtype";
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

const ALL_FILTER_FIELDS = [...PERSON_FILTER_FIELDS, ...WEAVER_FILTER_FIELDS];

const DEFAULT_PAGE_SIZE = 10;

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
];

const PersonsPage = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // ── Sticky URL state — every filter/toggle/pagination lives in the query
  // string so it survives reload and is deep-linkable. ────────────────────────
  const q = searchParams.get("q") ?? "";
  const includeWeavers = searchParams.get("weavers") === "true";
  const includeDeleted = searchParams.get("deleted") === "true";
  const pageIndex = Math.max(0, (parseInt(searchParams.get("page") || "1", 10) || 1) - 1);
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(searchParams.get("limit") || String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE)
  );
  const orderParam = searchParams.get("order") ?? undefined;

  const filtering: DataTableFilteringState = {};
  for (const f of ALL_FILTER_FIELDS) {
    const v = searchParams.get(f);
    // `null` = filter absent. An empty-string value is a select filter that
    // was added but has no value yet — it must stay visible (as `[]`) so the
    // DataTable renders its chip and auto-opens the picker.
    if (v === null) continue;
    filtering[f] = v === "" ? [] : [v];
  }

  const sorting: SortingState = (() => {
    if (!orderParam) return null;
    const [id, dir] = orderParam.split(":");
    return id ? { id, desc: dir === "DESC" } : null;
  })();

  // Mutate the URL params in place (replace, so filters don't spam history).
  const updateParams = useCallback(
    (mutate: (p: URLSearchParams) => void) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        mutate(next);
        return next;
      }, { replace: true });
    },
    [setSearchParams]
  );

  const resetPage = (p: URLSearchParams) => p.delete("page");

  const handlePaginationChange = useCallback(
    (newPagination: DataTablePaginationState) => {
      updateParams((p) => {
        if (newPagination.pageIndex > 0) p.set("page", String(newPagination.pageIndex + 1));
        else p.delete("page");
        if (newPagination.pageSize !== DEFAULT_PAGE_SIZE) p.set("limit", String(newPagination.pageSize));
        else p.delete("limit");
      });
    },
    [updateParams]
  );

  const handleFilterChange = useCallback(
    debounce((newFilters: DataTableFilteringState) => {
      updateParams((p) => {
        for (const f of ALL_FILTER_FIELDS) p.delete(f);
        for (const [k, v] of Object.entries(newFilters)) {
          if (Array.isArray(v)) {
            // Select filters arrive as string[]; an empty array is a just-added
            // filter with no value, serialised as an empty param so the read
            // side can reconstruct `[]` and keep the picker chip alive.
            p.set(k, v[0] ?? "");
          } else if (typeof v === "string" && v !== "") {
            p.set(k, v);
          }
        }
        resetPage(p);
      });
    }, 300),
    [updateParams]
  );

  const handleSearchChange = useCallback(
    debounce((newSearch: string) => {
      updateParams((p) => {
        if (newSearch) p.set("q", newSearch);
        else p.delete("q");
        resetPage(p);
      });
    }, 300),
    [updateParams]
  );

  const handleSortingChange = useCallback(
    (s: SortingState) => {
      updateParams((p) => {
        if (s && s.id) p.set("order", `${s.id}:${s.desc ? "DESC" : "ASC"}`);
        else p.delete("order");
      });
    },
    [updateParams]
  );

  const handleIncludeDeletedChange = useCallback(
    (checked: boolean) => {
      updateParams((p) => {
        if (checked) p.set("deleted", "true");
        else p.delete("deleted");
        resetPage(p);
      });
    },
    [updateParams]
  );

  const handleIncludeWeaversChange = useCallback(
    (checked: boolean) => {
      updateParams((p) => {
        if (checked) p.set("weavers", "true");
        else p.delete("weavers");
        // Filters are mode-specific; clear them when switching persons ↔ weavers.
        for (const f of ALL_FILTER_FIELDS) p.delete(f);
        resetPage(p);
      });
    },
    [updateParams]
  );

  // ── Query the backend from the URL-derived state ────────────────────────────
  const offset = pageIndex * pageSize;

  const filterQuery: Record<string, string> = {};
  for (const f of ALL_FILTER_FIELDS) {
    const v = filtering[f];
    const val = Array.isArray(v) ? v[0] : v;
    if (typeof val === "string" && val !== "") filterQuery[f] = val;
  }

  const {
    persons,
    count,
    weavers,
    weaversCount,
    censusConnected,
    isLoading,
  } = usePersons(
    {
      limit: pageSize,
      offset,
      q: q || undefined,
      withDeleted: includeDeleted,
      include_weavers: includeWeavers || undefined,
      ...(orderParam ? { order: orderParam } : {}),
      ...filterQuery,
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

  // Weaver filters; the state filter is sourced from ALL census states.
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
      state: { pageIndex, pageSize },
      onPaginationChange: handlePaginationChange,
    },
    search: {
      state: q,
      onSearchChange: handleSearchChange,
    },
    filtering: {
      state: filtering,
      onFilteringChange: handleFilterChange,
    },
    sorting: includeWeavers ? undefined : {
      state: sorting,
      onSortingChange: handleSortingChange,
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
                  onChange={(e) => handleIncludeDeletedChange(e.target.checked)}
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
                  onChange={(e) => handleIncludeWeaversChange(e.target.checked)}
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