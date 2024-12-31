import { AddressDetails, PersonWithAddress } from "@medusajs/framework/types";
import { Container, Heading } from "@medusajs/ui";
import { useTranslation } from "react-i18next";
import { PencilSquare } from "@medusajs/icons";
import { ActionMenu } from "../common/action-menu";

import { DataTable } from "../../components/table/data-table";
import { createColumnHelper } from "@tanstack/react-table";
import { useDataTable } from "../../hooks/usedataTable";

interface PersonsAddressSectionProps {
  person: PersonWithAddress;
}

const columnHelper = createColumnHelper<AddressDetails>();

export const PersonsAddressSection = ({ person }: PersonsAddressSectionProps) => {
  const { t } = useTranslation();
  
  // Ensure addresses is always an array
  const addresses = person?.addresses || [];

  const columns = [
    columnHelper.accessor("street", {
      header: () => t("fields.street"),
      cell: (info) => info.getValue(),
      size: 200,
    }),
    columnHelper.accessor("city", {
      header: () => t("fields.city"),
      cell: (info) => info.getValue(),
      size: 150,
    }),
    columnHelper.accessor("state", {
      header: () => t("fields.state"),
      cell: (info) => info.getValue(),
      size: 150,
    }),
    columnHelper.accessor("postal_code", {
      header: () => t("fields.postal_code"),
      cell: (info) => info.getValue(),
      size: 120,
    }),
    columnHelper.accessor("country", {
      header: () => t("fields.country"),
      cell: (info) => info.getValue(),
      size: 150,
    }),
  ];

  const { table } = useDataTable({
    data: addresses,
    columns,
    getRowId: (row) => row.id,
  });

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading>{t("Addresses")}</Heading>
        <ActionMenu
          groups={[
            {
              actions: [
                {
                  label: t("actions.add"),
                  icon: <PencilSquare />,
                  to: `add-address`,
                  
                },
              ],
            },
          ]}
        />
      </div>
      <DataTable
        table={table}
        columns={columns}
        count={addresses.length}
        pageSize={addresses.length || 1}
        pagination={false}
        noRecords={{
          message: "No address records found",
        }}
      />
    </Container>
  );
};
