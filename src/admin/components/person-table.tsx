import { useMemo } from "react";
import { Table as UiTable } from "@medusajs/ui";
import { clx } from "@medusajs/ui";
import { NoRecords, NoResultsProps } from "./empty-table";

export type Person = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  date_of_birth: string;
};

type PersonTableProps = {
  data: Person[];
  pageSize: number;
  count: number;
  currentPage: number;
  setCurrentPage: (value: number) => void;
  noRecords?: Pick<NoResultsProps, "title" | "message">;
  isLoading: boolean;
};

export const PersonTable = ({
  data,
  pageSize,
  count = 0,
  currentPage,
  setCurrentPage,
  noRecords: noRecordsProps = {},
  isLoading,
}: PersonTableProps) => {
  if (isLoading) {
    return <div className="p-4">Loading...</div>;
  }
  const pageCount = useMemo(
    () => Math.ceil(count / pageSize),
    [count, pageSize],
  );

  console.log(pageCount);

  const canNextPage = useMemo(
    () => currentPage < pageCount - 1,
    [currentPage, pageCount],
  );
  const canPreviousPage = useMemo(() => currentPage > 0, [currentPage]);

  const nextPage = () => {
    if (canNextPage) setCurrentPage(currentPage + 1);
  };

  const previousPage = () => {
    if (canPreviousPage) setCurrentPage(currentPage - 1);
  };

  const layout = "fit";

  return (
    <div className="flex h-full flex-col overflow-hidden !border-t-0">
      {data.length === 0 ? (
        <NoRecords
          className={clx({
            "flex h-full flex-col overflow-hidden": layout === "fill",
          })}
          {...noRecordsProps}
        />
      ) : (
        <>
          <UiTable>
            <UiTable.Header>
              <UiTable.Row>
                <UiTable.HeaderCell>First Name</UiTable.HeaderCell>
                <UiTable.HeaderCell>Last Name</UiTable.HeaderCell>
                <UiTable.HeaderCell>Email</UiTable.HeaderCell>
                <UiTable.HeaderCell>Date of Birth</UiTable.HeaderCell>
              </UiTable.Row>
            </UiTable.Header>
            <UiTable.Body>
              {data.map((person) => (
                <UiTable.Row key={person.id}>
                  <UiTable.Cell>{person.first_name}</UiTable.Cell>
                  <UiTable.Cell>{person.last_name}</UiTable.Cell>
                  <UiTable.Cell>{person.email}</UiTable.Cell>
                  <UiTable.Cell>{person.date_of_birth}</UiTable.Cell>
                </UiTable.Row>
              ))}
            </UiTable.Body>
          </UiTable>
          <UiTable.Pagination
            count={count}
            pageSize={pageSize}
            pageIndex={currentPage}
            pageCount={pageCount}
            canPreviousPage={canPreviousPage}
            canNextPage={canNextPage}
            previousPage={previousPage}
            nextPage={nextPage}
          />
        </>
      )}
    </div>
  );
};
