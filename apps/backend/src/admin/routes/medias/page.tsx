import {
  Button,
  Container,
  DataTable,
  DataTableFilteringState,
  DataTablePaginationState,
  createDataTableColumnHelper,
  createDataTableFilterHelper,
  Heading,
  Tabs,
  Text,
  useDataTable,
} from "@medusajs/ui";
import { Link, Outlet, useNavigate } from "react-router-dom";
import { useCallback, useMemo, useState } from "react";
import { EntityActions } from "../../components/persons/personsActions";
import { AdminMediaFolder } from "../../hooks/api/media-folders";
import { useMedias } from "../../hooks/api/media-folders/use-medias";
import debounce from "lodash/debounce";
import { PencilSquare } from "@medusajs/icons";
import CreateButton from "../../components/creates/create-button";

type SortingState = { id: string; desc: boolean } | null;

const columnHelper = createDataTableColumnHelper<AdminMediaFolder>();

export const useColumns = () => {
  const columns = useMemo(
    () => [
      columnHelper.accessor("name", {
        header: "Name",
        cell: (info) => info.getValue(),
        enableSorting: true,
        sortLabel: "Name",
        sortAscLabel: "A → Z",
        sortDescLabel: "Z → A",
      }),
      columnHelper.accessor("description", {
        header: "Description",
        cell: (info) => info.getValue() || "-",
      }),
      columnHelper.accessor("path", {
        header: "Path",
        cell: (info) => info.getValue(),
      }),
      columnHelper.accessor("level", {
        header: "Level",
        cell: (info) => info.getValue(),
        enableSorting: true,
        sortLabel: "Level",
        sortAscLabel: "Shallowest first",
        sortDescLabel: "Deepest first",
      }),
      columnHelper.accessor("is_public", {
        header: "Public",
        cell: (info) => (info.getValue() ? "Yes" : "No"),
      }),
    ],
    []
  );

  const folderActionsConfig = {
    actions: [
      {
        icon: <PencilSquare />,
        label: "Edit",
        to: (folder: AdminMediaFolder) => `/medias/${folder.id}/edit`,
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
            actionsConfig={folderActionsConfig}
          />
        ),
      }),
    ],
    [columns]
  );
};

type AdminAlbum = {
  id: string;
  name: string;
  description?: string | null;
  slug: string;
  type?: string;
  is_public?: boolean;
};
const albumColumnHelper = createDataTableColumnHelper<AdminAlbum>();
const useAlbumColumns = () =>
  useMemo(
    () => [
      albumColumnHelper.accessor("name", {
        header: "Name",
        enableSorting: true,
        sortLabel: "Name",
        sortAscLabel: "A → Z",
        sortDescLabel: "Z → A",
      }),
      albumColumnHelper.accessor("description", {
        header: "Description",
        cell: (i) => i.getValue() || "-",
      }),
      albumColumnHelper.accessor("slug", { header: "Slug" }),
      albumColumnHelper.accessor("type", {
        header: "Type",
        cell: (i) => i.getValue() || "-",
      }),
      albumColumnHelper.accessor("is_public", {
        header: "Public",
        cell: (i) => (i.getValue() ? "Yes" : "No"),
      }),
    ],
    []
  );

type AdminMediaFile = {
  id: string;
  file_name: string;
  mime_type: string;
  file_type?: string;
  file_size?: number;
  width?: number | null;
  height?: number | null;
  is_public?: boolean;
};
const fileColumnHelper = createDataTableColumnHelper<AdminMediaFile>();
const useFileColumns = () =>
  useMemo(
    () => [
      fileColumnHelper.accessor("file_name", {
        header: "File Name",
        enableSorting: true,
        sortLabel: "File name",
        sortAscLabel: "A → Z",
        sortDescLabel: "Z → A",
      }),
      fileColumnHelper.accessor("mime_type", { header: "MIME Type" }),
      fileColumnHelper.accessor("file_type", {
        header: "Type",
        cell: (i) => i.getValue() || "-",
      }),
      fileColumnHelper.accessor("file_size", {
        header: "Size",
        cell: (i) => (i.getValue() ? `${i.getValue()} B` : "-"),
        enableSorting: true,
        sortLabel: "Size",
        sortAscLabel: "Smallest first",
        sortDescLabel: "Largest first",
      }),
      fileColumnHelper.accessor("is_public", {
        header: "Public",
        cell: (i) => (i.getValue() ? "Yes" : "No"),
      }),
    ],
    []
  );

type TabView = "folders" | "albums" | "files";

// Preset date windows for the created_at filter — same shape used by other
// admin tables (see designs/page.tsx). Values are comparison operators the
// backend already accepts via `filters.created_at`.
const useDateFilterOptions = () =>
  useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    const daysAgo = (d: number) => {
      const date = new Date(startOfToday);
      date.setDate(date.getDate() - d);
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
      { label: "Last 7 days", value: { $gte: daysAgo(7) } },
      { label: "Last 30 days", value: { $gte: daysAgo(30) } },
      { label: "Last 90 days", value: { $gte: daysAgo(90) } },
      { label: "Last 12 months", value: { $gte: daysAgo(365) } },
    ];
  }, []);

const AllMediaPage = () => {
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabView>("folders");

  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageSize: 20,
    pageIndex: 0,
  });
  const [filtering, setFiltering] = useState<DataTableFilteringState>({});
  const [search, setSearch] = useState<string>("");
  const [sorting, setSorting] = useState<SortingState>({
    id: "created_at",
    desc: true,
  });

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

  // Tab switch: reset any column sort that only exists on one entity (e.g.
  // `file_name` on files) so we don't ship a sort key the folders/albums
  // workflow will reject — the backend also guards against this, but
  // clearing here keeps the UI indicator honest.
  const handleTabChange = useCallback((v: string) => {
    setTab(v as TabView);
    setSorting({ id: "created_at", desc: true });
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  }, []);

  const offset = pagination.pageIndex * pagination.pageSize;

  const mappedFilters = useMemo(() => {
    const out: Record<string, any> = {};
    if (search) out.q = search;
    for (const [key, value] of Object.entries(filtering)) {
      if (value === undefined || value === null) continue;
      if (key === "is_public") {
        out.is_public = value === "true" ? true : value === "false" ? false : value;
      } else if (key === "parent_folder_id") {
        if (value !== "") out.parent_folder_id = value;
      } else if (key === "file_type") {
        out.file_type = value;
      } else if (key === "created_at") {
        // DataTable date filter produces a comparison-operator object that
        // the backend already understands.
        out.created_at = value;
      }
    }
    return out;
  }, [search, filtering]);

  const orderConfig = useMemo(() => {
    if (!sorting?.id) return undefined;
    return { [sorting.id]: sorting.desc ? "DESC" : "ASC" } as Record<string, "ASC" | "DESC">;
  }, [sorting]);

  const {
    folders,
    folders_count,
    albums,
    albums_count,
    media_files,
    media_files_count,
    isLoading,
    isError,
    error,
  } = useMedias({
    skip: offset,
    take: pagination.pageSize,
    filters: mappedFilters,
    config: orderConfig ? { order: orderConfig } : undefined,
  });

  const folderColumns = useColumns();
  const albumColumns = useAlbumColumns();
  const fileColumns = useFileColumns();
  const columns: any =
    tab === "folders"
      ? folderColumns
      : tab === "albums"
      ? albumColumns
      : fileColumns;

  const filterHelper = createDataTableFilterHelper<AdminMediaFolder>();
  const dateFilterOptions = useDateFilterOptions();

  const filters = useMemo(() => {
    const base = [
      filterHelper.accessor("is_public", {
        type: "select",
        label: "Public",
        options: [
          { label: "Yes", value: "true" },
          { label: "No", value: "false" },
        ],
      }),
      filterHelper.accessor("created_at", {
        type: "date",
        label: "Created date",
        options: dateFilterOptions,
      }),
    ] as any[];
    if (tab === "folders") {
      base.push(
        filterHelper.accessor("parent_folder_id", {
          type: "select",
          label: "Parent Folder",
          options: ((): { label: string; value: string }[] => {
            if (!folders?.length) return [] as any;
            return folders
              .filter((f) => !!f.id)
              .map((f) => ({
                label: f.path || f.name || f.id,
                value: f.id,
              }));
          })(),
        })
      );
    }
    if (tab === "files") {
      base.push(
        filterHelper.accessor("file_type" as any, {
          type: "select",
          label: "File Type",
          options: [
            { label: "Images", value: "image" },
            { label: "Videos", value: "video" },
            { label: "Audio", value: "audio" },
            { label: "Documents", value: "document" },
            { label: "Archives", value: "archive" },
            { label: "Other", value: "other" },
          ],
        })
      );
    }
    return base;
  }, [filterHelper, tab, folders, dateFilterOptions]);

  const table = useDataTable<any>({
    columns: columns as any,
    data: (tab === "folders"
      ? folders ?? []
      : tab === "albums"
      ? (albums as any[]) ?? []
      : (media_files as any[]) ?? []) as any[],
    getRowId: (row: any) => row.id as string,
    onRowClick: (_, row) => {
      if (tab === "folders") {
        navigate(`/medias/${(row as any).id}`);
      }
    },
    rowCount:
      tab === "folders"
        ? folders_count
        : tab === "albums"
        ? albums_count
        : media_files_count,
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
    sorting: {
      state: sorting,
      onSortingChange: setSorting,
    },
  });

  if (isError) {
    throw error;
  }

  return (
    <div>
      <Container className="divide-y p-0">
        <DataTable instance={table}>
          <DataTable.Toolbar className="flex flex-col md:flex-row justify-between gap-y-4 px-6 py-4">
            <div className="flex-1 min-w-0">
              <Heading>All Media</Heading>
              <Text className="text-ui-fg-subtle" size="small">
                Browse folders, albums, and files
              </Text>
            </div>
            <div className="flex items-center gap-x-2">
              <Button asChild size="small" variant="secondary">
                <Link to="upload">Upload Files</Link>
              </Button>
              <CreateButton />
            </div>
          </DataTable.Toolbar>
          {/* Tabs + Search — Filter/Sort menus are rendered by
              <DataTable.Toolbar> itself (via its internal FilterBar), so
              putting them here again would draw them twice. */}
          <div className="flex items-center justify-between gap-x-4 px-6 py-4 border-t border-ui-border-base">
            <Tabs value={tab} onValueChange={handleTabChange}>
              <Tabs.List>
                <Tabs.Trigger value="folders">Folders</Tabs.Trigger>
                <Tabs.Trigger value="albums">Albums</Tabs.Trigger>
                <Tabs.Trigger value="files">Files</Tabs.Trigger>
              </Tabs.List>
            </Tabs>
            <DataTable.Search placeholder="Search medias..." />
          </div>
          <DataTable.Table />
          <DataTable.Pagination />
        </DataTable>
      </Container>
      <Outlet />
    </div>
  );
};

export default AllMediaPage;

// Sidebar entry removed — reached via /admin/operations hub. URL still works.

export const handle = {
  breadcrumb: () => "Medias",
};
