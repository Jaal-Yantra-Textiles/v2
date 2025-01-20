import React from "react";
import { CardFilters, FilterType } from "./card-filters";
import { Pagination } from "@/components/ui/pagination";
import { Input } from "@/components/ui/input";
import { MagnifyingGlass } from "@medusajs/icons";

interface CardTableProps<T> {
  data: T[];
  count: number;
  pageIndex: number;
  pageSize: number;
  filters?: FilterType[];
  isLoading?: boolean;
  searchPlaceholder?: string;
  setPageIndex: (index: number) => void;
  setPageSize: (size: number) => void;
  setFilter: (key: string, value: any) => void;
  resetFilter: (key: string) => void;
  renderCard: (item: T) => React.ReactNode;
}

export function CardTable<T>({
  data,
  count,
  pageIndex,
  pageSize,
  filters,
  isLoading,
  searchPlaceholder = "Search...",
  setPageIndex,
  setPageSize,
  setFilter,
  resetFilter,
  renderCard,
}: CardTableProps<T>) {
  const pageCount = Math.ceil(count / pageSize);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="relative w-72">
          <MagnifyingGlass className="absolute left-2 top-2.5 h-4 w-4 text-ui-fg-subtle" />
          <Input
            placeholder={searchPlaceholder}
            className="pl-8 bg-ui-bg-base border-ui-border-base"
            onChange={(e) => setFilter("q", e.target.value)}
          />
        </div>
        {filters && filters.length > 0 && (
          <CardFilters
            filters={filters}
            setFilter={setFilter}
            resetFilter={resetFilter}
          />
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <div className="loading" />
        </div>
      ) : data.length === 0 ? (
        <div className="flex items-center justify-center py-10 text-ui-fg-subtle">
          No results found
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((item, index) => (
            <div key={index}>{renderCard(item)}</div>
          ))}
        </div>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-center">
          <Pagination
            pageIndex={pageIndex}
            pageCount={pageCount}
            pageSize={pageSize}
            setPageIndex={setPageIndex}
            setPageSize={setPageSize}
          />
        </div>
      )}
    </div>
  );
}
