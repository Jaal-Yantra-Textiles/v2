import { Container, Heading, Text, DataTable, useDataTable, CommandBar } from "@medusajs/ui";
import { useTranslation } from "react-i18next";
import { PencilSquare } from "@medusajs/icons";
import { ActionMenu } from "../common/action-menu";
import { useState, useEffect } from "react";
import { PersonWithAddress } from "../../hooks/api/personandtype";
import { toast } from "@medusajs/ui";
import { useNavigate } from "react-router-dom";
import { TableSectionSkeleton } from "../table/skeleton";

interface PersonsAddressSectionProps {
  person: PersonWithAddress;
}

export const PersonsAddressSection = ({ person }: PersonsAddressSectionProps) => {
  const { t } = useTranslation();
  const [selectedRows, setSelectedRows] = useState<Record<string, boolean>>({});
  const [isCommandBarOpen, setIsCommandBarOpen] = useState(false);
  
  // Ensure addresses is always an array
  const addresses = person?.addresses || [];

  // Command bar handlers
  const handleDelete = () => {
    // Implement delete functionality for selected addresses
    const selectedAddressIds = Object.keys(selectedRows);
    toast.info(`Delete requested for addresses: ${selectedAddressIds.join(', ')}`);
    // Add actual delete API call when available
  };

  const navigate = useNavigate();

  const handleEdit = () => {
    const selectedId = Object.keys(selectedRows)[0];
    navigate(`/persons/${person.id}/edit-address/${selectedId}`);
  };

  // Row selection handler
  const handleRowSelect = (rowId: string) => {
    setSelectedRows(prev => {
      const newState = { ...prev };
      if (newState[rowId]) {
        delete newState[rowId];
      } else {
        newState[rowId] = true;
      }
      return newState;
    });
  };

  // Select all handler
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const allSelected = addresses.reduce((acc, address) => {
        acc[address.id] = true;
        return acc;
      }, {} as Record<string, boolean>);
      setSelectedRows(allSelected);
    } else {
      setSelectedRows({});
    }
  };

  // Update command bar visibility when selections change
  useEffect(() => {
    const hasSelections = Object.keys(selectedRows).length > 0;
    setIsCommandBarOpen(hasSelections);
  }, [selectedRows]);

  // Add escape key handler to clear selections
  useEffect(() => {
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isCommandBarOpen) {
        // Clear all selections
        setSelectedRows({});
        setIsCommandBarOpen(false);
        event.preventDefault();
      }
    };

    if (isCommandBarOpen) {
      window.addEventListener('keydown', handleEscapeKey);
    }
    
    return () => {
      window.removeEventListener('keydown', handleEscapeKey);
    };
  }, [isCommandBarOpen]);

  // Define columns
  const columns = [
    {
      accessorKey: "select",
      header: ({ table }: { table: any }) => (
        <input
          type="checkbox"
          checked={table.getIsAllRowsSelected()}
          onChange={(e) => {
            table.toggleAllRowsSelected(e.target.checked);
            handleSelectAll(e.target.checked);
          }}
        />
      ),
      cell: ({ row }: { row: any }) => (
        <input
          type="checkbox"
          checked={selectedRows[row.id] || false}
          onChange={(e) => {
            row.toggleSelected(e.target.checked);
            handleRowSelect(row.id);
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ),
      size: 50,
    },
    {
      accessorKey: "street",
      header: t("fields.street"),
      size: 200,
    },
    {
      accessorKey: "city",
      header: t("fields.city"),
      size: 150,
    },
    {
      accessorKey: "state",
      header: t("fields.state"),
      size: 150,
    },
    {
      accessorKey: "postal_code",
      header: t("fields.postal_code"),
      size: 120,
    },
    {
      accessorKey: "country",
      header: t("fields.country"),
      size: 150,
    },
  ];

  const table = useDataTable({
    columns,
    data: addresses,
    getRowId: (row) => row.id,
    rowSelection: {
      state: {},
      onRowSelectionChange: () => {
        // Handle row selection changes if needed
        // This is handled manually via the checkbox clicks
      },
      enableRowSelection: true
    },
    onRowClick: (_, row) => {
      handleRowSelect(row.id as string);
    },
  });

  if (!addresses) {
    return <TableSectionSkeleton rowCount={3} />;
  }

  return (
    <Container className="divide-y p-0">
      <CommandBar open={isCommandBarOpen}>
        <CommandBar.Bar>
          <CommandBar.Value>{Object.keys(selectedRows).length} selected</CommandBar.Value>
          <CommandBar.Command
            action={handleEdit}
            label="Edit"
            shortcut="e"
            disabled={Object.keys(selectedRows).length !== 1}
          />
          <CommandBar.Seperator />
          <CommandBar.Command
            action={handleDelete}
            label="Delete"
            shortcut="d"
          />
        </CommandBar.Bar>
      </CommandBar>
      <DataTable instance={table}>
        <DataTable.Toolbar className="flex justify-between items-center">
          <div>
            <Heading level="h2">{t("Addresses")}</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Contact addresses for this person
            </Text>
          </div>
          <div className="flex items-center gap-x-2">
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
        </DataTable.Toolbar>
        <DataTable.Table />
        {addresses.length > 10 && <DataTable.Pagination />}
        {addresses.length === 0 && (
          <div className="flex items-center justify-center py-10">
            <Text className="text-ui-fg-subtle">No address records found</Text>
          </div>
        )}
      </DataTable>
    </Container>
  );
};
