import {
    ChevronLeft, ChevronRight
  } from "@medusajs/icons";
  import { Button } from "@medusajs/ui";
  import {
    Select,
  } from "@medusajs/ui";
  
  interface PaginationProps {
    pageIndex: number;
    pageCount: number;
    pageSize: number;
    setPageIndex: (index: number) => void;
    setPageSize: (size: number) => void;
  }
  
  export function Pagination({
    pageIndex,
    pageCount,
    pageSize,
    setPageIndex,
    setPageSize,
  }: PaginationProps) {
    return (
      <div className="flex items-center justify-between px-2">
        <div className="flex items-center gap-2">
          <p className="text-sm text-muted-foreground">Items per page</p>
          <Select
            value={pageSize.toString()}
            onValueChange={(value) => setPageSize(Number(value))}
          >
            <Select.Trigger className="h-8 w-[70px]">
              <Select.Value placeholder={pageSize} />
            </Select.Trigger>
            <Select.Content side="top">
              {[10, 20, 30, 40, 50].map((size) => (
                <Select.Item key={size} value={size.toString()}>
                  {size}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        </div>
  
        <div className="flex items-center gap-2">
          <div className="flex w-[100px] items-center justify-center text-sm text-muted-foreground">
            Page {pageIndex + 1} of {pageCount}
          </div>
          <div className="flex items-center gap-0.5">
            <Button
              variant="primary"
              className="h-8 w-8 p-0"
              onClick={() => setPageIndex(0)}
              disabled={pageIndex === 0}
            >
              <span className="sr-only">Go to first page</span>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="primary"
              className="h-8 w-8 p-0"
              onClick={() => setPageIndex(pageIndex - 1)}
              disabled={pageIndex === 0}
            >
              <span className="sr-only">Go to previous page</span>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="primary"
              className="h-8 w-8 p-0"
              onClick={() => setPageIndex(pageIndex + 1)}
              disabled={pageIndex === pageCount - 1}
            >
              <span className="sr-only">Go to next page</span>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="primary"
              className="h-8 w-8 p-0"
              onClick={() => setPageIndex(pageCount - 1)}
              disabled={pageIndex === pageCount - 1}
            >
              <span className="sr-only">Go to last page</span>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    );
  }
  