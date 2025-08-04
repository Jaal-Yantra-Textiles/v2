import { Container, Heading, Text, DataTable, useDataTable, CommandBar } from "@medusajs/ui";
import { useTranslation } from "react-i18next";
import { PencilSquare } from "@medusajs/icons";
import { ActionMenu } from "../common/action-menu";
import { useState, useEffect } from "react";
import { toast, usePrompt } from "@medusajs/ui";
import { useNavigate } from "react-router-dom";
import { useDeletePersonContact, ContactDetail } from "../../hooks/api/person-contacts";
import { TableSectionSkeleton } from "../table/skeleton";

// Define the person with contact details interface
interface PersonWithContactDetails {
  id: string;
  contact_details?: ContactDetail[];
  [key: string]: any;
}

interface PersonContactSectionProps {
  person: PersonWithContactDetails;
}

export const PersonContactSection = ({ person }: PersonContactSectionProps) => {
  const { t } = useTranslation();
  const [selectedRows, setSelectedRows] = useState<Record<string, boolean>>({});
  const [isCommandBarOpen, setIsCommandBarOpen] = useState(false);
  const prompt = usePrompt();
  const navigate = useNavigate();
  
  // Use contact_details directly from the person object
  const contacts = person.contact_details || [];
  
  
  // Get the selected contact ID (for edit/delete operations)
  const getSelectedContactId = () => {
    const selectedIds = Object.keys(selectedRows);
    return selectedIds.length === 1 ? selectedIds[0] : null;
  };

  // Command bar handlers
  const handleDelete = async () => {
    const selectedContactIds = Object.keys(selectedRows);
    if (selectedContactIds.length === 0) {
      toast.error('Please select at least one contact to delete');
      return;
    }
    
    // For simplicity, we'll only support deleting one contact at a time
    const contactId = selectedContactIds[0];
    const contactToDelete = contacts.find(c => c.id === contactId);
    
    if (!contactToDelete) {
      toast.error('Selected contact not found');
      return;
    }
    
    const res = await prompt({
      title: t("contacts.delete.title"),
      description: t("contacts.delete.description", {
        phone: contactToDelete.phone_number,
      }),
      verificationInstruction: t("general.typeToConfirm"),
      verificationText: contactToDelete.phone_number,
      confirmText: t("actions.delete"),
      cancelText: t("actions.cancel"),
    });

    if (!res) {
      return;
    }
    
    // Get the delete mutation for this contact
    const { mutateAsync } = useDeletePersonContact(person.id, contactId);
    
    try {
      await mutateAsync();
      toast.success('Contact deleted successfully');
      setSelectedRows({});
      // No need to refetch as the parent component should handle refreshing the person data
    } catch (error: any) {
      toast.error(error?.message || 'Failed to delete contact');
    }
  };

  const handleEdit = () => {
    const contactId = getSelectedContactId();
    if (!contactId) {
      toast.error('Please select exactly one contact to edit');
      return;
    }
    
    // Navigate to the edit contact page
    navigate(`/persons/${person.id}/edit-contact/${contactId}`);
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
      const allSelected = contacts.reduce((acc, contact) => {
        acc[contact.id] = true;
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

  // Format contact type for display
  const formatContactType = (type: string) => {
    return type.charAt(0).toUpperCase() + type.slice(1);
  };
  
  // Handle adding a new contact
  const handleAddContact = () => {
    navigate(`/persons/${person.id}/add-contact`);
  };

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
      accessorKey: "phone_number",
      header: t("fields.phoneNumber"),
      size: 200,
    },
    {
      accessorKey: "type",
      header: t("fields.type"),
      size: 150,
      cell: ({ row }: { row: any }) => formatContactType(row.getValue("type")),
    },
  ];

  const table = useDataTable({
    columns,
    data: contacts,
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

  if (!contacts) {
    return <TableSectionSkeleton rowCount={3} />
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
            <Heading level="h2">{t("Contact Details")}</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Phone numbers and contact information for this person
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
                      onClick: handleAddContact,
                    },
                  ],
                },
              ]}
            />
          </div>
        </DataTable.Toolbar>
        <DataTable.Table />
        {contacts.length > 10 && <DataTable.Pagination />}
        {contacts.length === 0 && (
          <div className="flex items-center justify-center py-10">
            <Text className="text-ui-fg-subtle">No contact details found</Text>
          </div>
        )}
      </DataTable>
    </Container>
  );
};
