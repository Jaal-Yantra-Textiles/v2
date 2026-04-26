import React from "react";
import { DataTableFilter, Filter } from "./data-table-filter";
import { DataTableSearch } from "./data-table-search";
import { Table } from "@medusajs/ui";
import { TableSkeleton } from "./skeleton";
import { NoRecords, NoResultsProps } from "../empty-table";
import { useSearchParams, useNavigate } from "react-router-dom";
import { clx } from "@medusajs/ui";
import { useTranslation } from "react-i18next";
import type { ComponentPropsWithoutRef } from "react";

interface CardTableQueryProps {
  search?: boolean | "autofocus";
  filters?: Filter[];
}

interface CardTableProps<T> {
  isLoading?: boolean;
  count?: number;
  pageIndex: number;
  pageSize: number;
  queryObject: Record<string, any>;
  renderCard: (item: T) => React.ReactNode;
  data?: T[];
  navigateTo?: (item: T) => string;
  search?: boolean | "autofocus";
  filters?: Filter[];
  layout?: "fill" | "fit";
  onQueryChange?: (query: Record<string, any>) => void;
  noRecords?: Pick<NoResultsProps, "title" | "message">;
}

function CardTableQuery({ search, filters }: CardTableQueryProps) {
  return (
    <div className="flex items-start justify-between gap-x-4 px-6 py-4">
      <div className="w-full max-w-[60%]">
        {filters && filters.length > 0 && (
          <DataTableFilter
            filters={filters}
          />
        )}
      </div>
      <div className="flex shrink-0 items-center gap-x-2">
        {search && (
          <DataTableSearch
            autofocus={search === "autofocus"}
          />
        )}
      </div>
    </div>
  );
}

type PaginationProps = Omit<
  ComponentPropsWithoutRef<typeof Table.Pagination>,
  "translations"
>;

const Pagination = (props: PaginationProps) => {
  const { t } = useTranslation();

  const translations = {
    of: t("general.of"),
    results: t("general.results"),
    pages: t("general.pages"),
    prev: t("general.prev"),
    next: t("general.next"),
  };

  return (
    <Table.Pagination
      className="flex-shrink-0"
      {...props}
      translations={translations}
    />
  );
};

export function CardTable<T>({
  isLoading,
  count = 0,
  pageIndex,
  pageSize,
  queryObject,
  renderCard,
  data = [],
  navigateTo,
  search,
  filters,
  layout = "fit",
  onQueryChange,
  noRecords: noRecordsProps = {},
}: CardTableProps<T>) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const calculatedPageCount = Math.ceil(count / pageSize);

  const handlePageChange = (newPageIndex: number) => {
    const newOffset = newPageIndex * pageSize;
    searchParams.set("offset", newOffset.toString());
    setSearchParams(searchParams, { replace: true });
    onQueryChange?.({ ...queryObject, offset: newOffset });
  };

  if (isLoading) {
    return <TableSkeleton />;
  }

  return (
    <div className={clx("divide-y", {
      "flex h-full flex-col overflow-hidden": layout === "fill",
    })}>
      <CardTableQuery
        search={search}
        filters={filters}
      />

      {!isLoading && count === 0 ? (
        <div className="flex h-full w-full items-center justify-center py-12">
          <NoRecords {...noRecordsProps} />
        </div>
      ) : (
        <>
          <div className="px-6 py-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {data.map((item, index) => {
                
                const to = navigateTo?.(item);
                
                return (
                  <div 
                    key={index} 
                    className={clx("transition-fg group/card", {
                      "cursor-pointer": !!to,
                      "hover:bg-ui-bg-base-hover": !!to,
                    })}
                  >
                    {to ? (
                      <div
                        onClick={(e) => {
                          // Only prevent if it's not from a nested link
                          if (!(e.target as HTMLElement).closest('a')) {
                            e.preventDefault();
                            navigate(`${to}`);
                          }
                        }}
                        className="block outline-none"
                        role="button"
                        tabIndex={0}
                      >
                        {renderCard(item)}
                      </div>
                    ) : (
                      renderCard(item)
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {calculatedPageCount > 0 && (
            <div className={clx("flex-shrink-0", { "border-t": layout === "fill" })}>
              <Pagination
                count={count}
                pageSize={pageSize}
                pageIndex={pageIndex}
                pageCount={calculatedPageCount}
                canNextPage={pageIndex < calculatedPageCount - 1}
                canPreviousPage={pageIndex > 0}
                nextPage={() => handlePageChange(pageIndex + 1)}
                previousPage={() => handlePageChange(pageIndex - 1)}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
