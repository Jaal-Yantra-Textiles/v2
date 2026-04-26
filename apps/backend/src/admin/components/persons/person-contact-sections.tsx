import { PencilSquare } from "@medusajs/icons"
import {
  CommandBar,
  Container,
  DataTable,
  Heading,
  Text,
  toast,
  useDataTable,
  usePrompt,
} from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import { useEffect, useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"

import {
  useDeletePersonContact,
  usePersonContacts,
} from "../../hooks/api/person-contacts"
import { AdminPerson, ContactDetail } from "../../hooks/api/personandtype"
import { ActionMenu } from "../common/action-menu"
import { TableSectionSkeleton } from "../table/skeleton"
import { PERSON_RESOURCE_META } from "../../hooks/api/person-resource-meta"
import { personsQueryKeys } from "../../hooks/api/persons"

interface PersonContactSectionProps {
  personId: string
  initialContacts?: ContactDetail[]
}

export const PersonContactSection = ({
  personId,
  initialContacts,
}: PersonContactSectionProps) => {
  const { t } = useTranslation()
  const [selectedRows, setSelectedRows] = useState<Record<string, boolean>>({})
  const [isCommandBarOpen, setIsCommandBarOpen] = useState(false)
  const prompt = usePrompt()
  const navigate = useNavigate()
  const deleteContact = useDeletePersonContact(personId)
  const queryClient = useQueryClient()
  const contactsListQueryKey = useMemo(
    () =>
      [
        "persons",
        "resources",
        PERSON_RESOURCE_META.contacts.pathSegment,
        personId,
        "list",
        { query: {} },
      ] as const,
    [personId],
  )

  useEffect(() => {
    if (initialContacts === undefined) {
      return
    }

    queryClient.setQueryData(
      contactsListQueryKey,
      (prev: Record<string, any> | undefined) => ({
        ...(prev ?? {}),
        [PERSON_RESOURCE_META.contacts.listKey]: initialContacts,
        count: initialContacts.length,
      }),
    )
  }, [initialContacts, queryClient, contactsListQueryKey])

  const { contacts = [], isPending } = usePersonContacts(
    personId,
    undefined,
    initialContacts !== undefined
      ? {
          initialData: {
            contacts: initialContacts,
            count: initialContacts.length,
          },
        }
      : undefined,
  )
  
  // Get the selected contact ID (for edit/delete operations)
  const getSelectedContactId = () => {
    const selectedIds = Object.keys(selectedRows);
    return selectedIds.length === 1 ? selectedIds[0] : null;
  };

  const removeContactFromCaches = (contactId: string) => {
    queryClient.setQueryData(
      contactsListQueryKey,
      (prev: Record<string, any> | undefined) => {
        if (!prev) {
          return prev
        }

        const current = (prev[PERSON_RESOURCE_META.contacts.listKey] as ContactDetail[] | undefined) ?? []
        const next = current.filter((contact) => contact.id !== contactId)

        return {
          ...prev,
          [PERSON_RESOURCE_META.contacts.listKey]: next,
          count: next.length,
        }
      },
    )

    queryClient.setQueriesData(
      { queryKey: personsQueryKeys.detail(personId), exact: false },
      (old: { person?: AdminPerson } | undefined) => {
        if (!old?.person?.contact_details) {
          return old
        }

        return {
          ...old,
          person: {
            ...old.person,
            contact_details: old.person.contact_details.filter(
              (contact) => contact.id !== contactId,
            ),
          },
        }
      },
    )
  }

  // Command bar handlers
  const handleDelete = async () => {
    const selectedContactIds = Object.keys(selectedRows);
    if (selectedContactIds.length === 0) {
      toast.error('Please select at least one contact to delete');
      return;
    }
    
    // For simplicity, we'll only support deleting one contact at a time
    const contactId = selectedContactIds[0];
    const contactToDelete = contacts.find((c) => c.id === contactId)
    
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
    
    try {
      await deleteContact.mutateAsync(contactId)
      toast.success('Contact deleted successfully');
      setSelectedRows({});
      removeContactFromCaches(contactId);
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
    navigate(`/persons/${personId}/edit-contact/${contactId}`)
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
    navigate(`/persons/${personId}/add-contact`)
  };

  // Define columns
  const columns = useMemo(
    () => [
      {
        accessorKey: "select",
        header: ({ table }: { table: any }) => (
          <input
            type="checkbox"
            checked={table.getIsAllRowsSelected()}
            onChange={(e) => {
              table.toggleAllRowsSelected(e.target.checked)
              handleSelectAll(e.target.checked)
            }}
          />
        ),
        cell: ({ row }: { row: any }) => (
          <input
            type="checkbox"
            checked={selectedRows[row.id] || false}
            onChange={(e) => {
              row.toggleSelected(e.target.checked)
              handleRowSelect(row.id)
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
    ],
    [selectedRows, t],
  )

  const table = useDataTable({
    columns,
    data: contacts,
    getRowId: (row) => row.id as string,
    rowSelection: {
      state: {},
      onRowSelectionChange: () => {},
      enableRowSelection: true,
    },
    onRowClick: (_, row) => {
      handleRowSelect(row.id as string)
    },
  })

  if (isPending) {
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
