import { Container, Heading, Text, DataTable, useDataTable, createDataTableFilterHelper, DataTablePaginationState, DataTableFilteringState, Tabs } from "@medusajs/ui";
import { Outlet, useNavigate } from "react-router-dom";
import { useMemo, useState, useCallback } from "react";
import { EntityActions } from "../../components/persons/personsActions";
import { createColumnHelper } from "@tanstack/react-table";
import { AdminMediaFolder } from "../../hooks/api/media-folders";
import { useMedias } from "../../hooks/api/media-folders/use-medias";
import debounce from "lodash/debounce";
import { Folder, PencilSquare } from "@medusajs/icons";
import CreateButton from "../../components/creates/create-button";
import { defineRouteConfig } from "@medusajs/admin-sdk";

const columnHelper = createColumnHelper<AdminMediaFolder>();

export const useColumns = () => {
  const columns = useMemo(
    () => [
      columnHelper.accessor("name", {
        header: "Name",
        cell: (info) => info.getValue(),
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
      }),
      columnHelper.accessor("is_public", {
        header: "Public",
        cell: (info) => info.getValue() ? "Yes" : "No",
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

// Albums table columns (minimal)
type AdminAlbum = {
  id: string
  name: string
  description?: string | null
  slug: string
  type?: string
  is_public?: boolean
}
const albumColumnHelper = createColumnHelper<AdminAlbum>()
const useAlbumColumns = () => {
  return useMemo(
    () => [
      albumColumnHelper.accessor("name", { header: "Name" }),
      albumColumnHelper.accessor("description", { header: "Description", cell: (i) => i.getValue() || "-" }),
      albumColumnHelper.accessor("slug", { header: "Slug" }),
      albumColumnHelper.accessor("type", { header: "Type", cell: (i) => i.getValue() || "-" }),
      albumColumnHelper.accessor("is_public", { header: "Public", cell: (i) => (i.getValue() ? "Yes" : "No") }),
    ],
    []
  )
}

// Files table columns (re-use MediaFile interface from hooks)
type AdminMediaFile = {
  id: string
  file_name: string
  mime_type: string
  file_type?: string
  file_size?: number
  width?: number | null
  height?: number | null
  is_public?: boolean
}
const fileColumnHelper = createColumnHelper<AdminMediaFile>()
const useFileColumns = () => {
  return useMemo(
    () => [
      fileColumnHelper.accessor("file_name", { header: "File Name" }),
      fileColumnHelper.accessor("mime_type", { header: "MIME Type" }),
      fileColumnHelper.accessor("file_type", { header: "Type", cell: (i) => i.getValue() || "-" }),
      fileColumnHelper.accessor("file_size", { header: "Size", cell: (i) => (i.getValue() ? `${i.getValue()} B` : "-") }),
      fileColumnHelper.accessor("is_public", { header: "Public", cell: (i) => (i.getValue() ? "Yes" : "No") }),
    ],
    []
  )
}

type TabView = "folders" | "albums" | "files"

const AllMediaPage = () => {
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabView>("folders")
  
  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageSize: 20,
    pageIndex: 0,
  });
  const [filtering, setFiltering] = useState<DataTableFilteringState>({});
  const [search, setSearch] = useState<string>("");
  
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
    // Forward search and filters in a generic way; backend can map as needed
    filters: {
      q: search || undefined,
      ...(Object.keys(filtering).length > 0
        ? Object.entries(filtering).reduce((acc, [key, value]) => {
            if (key === "is_public") {
              acc.is_public = value === "true" ? true : value === "false" ? false : value;
            } else if (key === "parent_folder_id") {
              acc.parent_folder_id = value as string;
            }
            return acc;
          }, {} as Record<string, any>)
        : {}),
    },
  });

  const folderColumns = useColumns();
  const albumColumns = useAlbumColumns();
  const fileColumns = useFileColumns();
  const columns: any = tab === "folders" ? folderColumns : tab === "albums" ? albumColumns : fileColumns;
  
  // Create filter helper
  const filterHelper = createDataTableFilterHelper<AdminMediaFolder>();
  
  // Define filters for the DataTable
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
    ] as any[]
    if (tab === "folders") {
      base.push(
        filterHelper.accessor("parent_folder_id", {
          type: "select",
          label: "Parent Folder ID",
          options: ((): { label: string; value: string }[] => {
            if (!folders?.length) return [] as any;
            const uniqueParentFolders = [...new Set(folders.map((f) => f.parent_folder_id))];
            return uniqueParentFolders.map((id) => ({ label: id || "", value: id || "" }));
          })(),
        })
      )
    }
    return base
  }, [filterHelper, tab, folders])

  const table = useDataTable<any>({
    columns: columns as any,
    data: (tab === "folders" ? (folders ?? []) : tab === "albums" ? (albums as any[] ?? []) : (media_files as any[] ?? [])) as any[],
    getRowId: (row: any) => row.id as string,
    onRowClick: (_, row) => {
      if (tab === "folders") {
        navigate(`/medias/${(row as any).id}`)
      }
    },
    rowCount: tab === "folders" ? folders_count : tab === "albums" ? albums_count : media_files_count,
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
      <DataTable instance={table}>
        <DataTable.Toolbar className="flex flex-col md:flex-row justify-between gap-y-4 px-6 py-4">
          <div className="flex-1 min-w-0">
            <Heading>All Media</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Browse folders, albums, and files
            </Text>
          </div>
          <div className="flex items-center gap-x-2">
            <CreateButton />
          </div>
        </DataTable.Toolbar>
        {/* Tabs row (divided section) */}
        <div className="flex items-start justify-between gap-x-4 px-6 py-4 border-t border-ui-border-base">
          <div className="w-full max-w-[60%] flex items-center gap-x-4">
            <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
              <Tabs.List>
                <Tabs.Trigger value="folders">Folders</Tabs.Trigger>
                <Tabs.Trigger value="albums">Albums</Tabs.Trigger>
                <Tabs.Trigger value="files">Files</Tabs.Trigger>
              </Tabs.List>
            </Tabs>
          </div>
          <div className="flex shrink-0 items-center gap-x-2" />
        </div>
        {/* Search and filter row (divided section) */}
        <div className="flex items-start justify-between gap-x-4 px-6 py-4 border-t border-ui-border-base">
          <div className="w-full max-w-[60%] flex items-center gap-x-4">
            <DataTable.FilterMenu tooltip="Filter medias" />
          </div>
          <div className="flex shrink-0 items-center gap-x-2">
            <DataTable.Search placeholder="Search medias..." />
          </div>
        </div>
        <DataTable.Table />
        <DataTable.Pagination />
      </DataTable>
    </Container>
    <Outlet></Outlet>
    </div>
  );
};

export default AllMediaPage;

export const config = defineRouteConfig({
  label: "Medias",
  icon: Folder,
});

export const handle = {
  breadcrumb: () => "Medias",
};
