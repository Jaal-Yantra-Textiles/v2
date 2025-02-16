import { ColumnDef } from "@tanstack/react-table";
import { AdminBlock } from "../../../hooks/api/blocks";
import { Badge } from "@medusajs/ui";

export const useBlocksColumns = () => {
  const columns: ColumnDef<AdminBlock>[] = [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => {
        return (
          <div className="flex flex-col">
            <span className="font-semibold">{row.original.name}</span>
          </div>
        );
      },
    },
    {
      accessorKey: "type",
      header: "Type",
      cell: ({ row }) => {
        return (
          <Badge>
            {row.original.type}
          </Badge>
        );
      },
    },
    {
      accessorKey: "order",
      header: "Order",
      cell: ({ row }) => {
        return row.original.order;
      },
    },
  ];

  return columns;
};
