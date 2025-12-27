import { PencilSquare } from "@medusajs/icons"
import {
  CommandBar,
  Container,
  DataTable,
  Heading,
  Text,
  toast,
  useDataTable,
} from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"

import { useDeletePersonAddress, usePersonAddresses } from "../../hooks/api/person-addresses"
import { AddressDetails, AdminPerson } from "../../hooks/api/personandtype"
import { ActionMenu } from "../common/action-menu"
import { TableSectionSkeleton } from "../table/skeleton"
import { PERSON_RESOURCE_META } from "../../hooks/api/person-resource-meta"
import { personsQueryKeys } from "../../hooks/api/persons"

interface PersonsAddressSectionProps {
  personId: string
  initialAddresses?: AddressDetails[]
}

export const PersonsAddressSection = ({
  personId,
  initialAddresses,
}: PersonsAddressSectionProps) => {
  const { t } = useTranslation()
  const [selectedRows, setSelectedRows] = useState<Record<string, boolean>>({})
  const [isCommandBarOpen, setIsCommandBarOpen] = useState(false)
  const navigate = useNavigate()
  const deleteAddress = useDeletePersonAddress(personId)
  const queryClient = useQueryClient()
  const addressesListQueryKey = useMemo(
    () =>
      [
        "persons",
        "resources",
        PERSON_RESOURCE_META.addresses.pathSegment,
        personId,
        "list",
        { query: {} },
      ] as const,
    [personId],
  )

  useEffect(() => {
    if (initialAddresses === undefined) {
      return
    }

    queryClient.setQueryData(
      addressesListQueryKey,
      (prev: Record<string, any> | undefined) => ({
        ...(prev ?? {}),
        [PERSON_RESOURCE_META.addresses.listKey]: initialAddresses,
        count: initialAddresses.length,
      }),
    )
  }, [initialAddresses, queryClient, addressesListQueryKey])

  const { addresses = [], isPending } = usePersonAddresses(
    personId,
    undefined,
    initialAddresses !== undefined
      ? {
          initialData: {
            addresses: initialAddresses,
            count: initialAddresses.length,
          },
        }
      : undefined,
  )

  const removeAddressFromCaches = (addressId: string) => {
    queryClient.setQueryData(
      addressesListQueryKey,
      (prev: Record<string, any> | undefined) => {
        if (!prev) {
          return prev
        }

        const current = (prev[PERSON_RESOURCE_META.addresses.listKey] as AddressDetails[] | undefined) ?? []
        const next = current.filter((address) => address.id !== addressId)

        return {
          ...prev,
          [PERSON_RESOURCE_META.addresses.listKey]: next,
          count: next.length,
        }
      },
    )

    queryClient.setQueriesData(
      { queryKey: personsQueryKeys.detail(personId), exact: false },
      (old: { person?: AdminPerson } | undefined) => {
        if (!old?.person?.addresses) {
          return old
        }

        return {
          ...old,
          person: {
            ...old.person,
            addresses: old.person.addresses.filter((address) => address.id !== addressId),
          },
        }
      },
    )
  }

  const handleDelete = async () => {
    const selectedAddressIds = Object.keys(selectedRows)
    if (!selectedAddressIds.length) {
      toast.error(t("persons.address.toast.select_for_delete"))
      return
    }

    try {
      await deleteAddress.mutateAsync(selectedAddressIds[0])
      toast.success(t("persons.address.toast.deleted"))
      setSelectedRows({})
      removeAddressFromCaches(selectedAddressIds[0])
    } catch (error: any) {
      toast.error(error?.message || t("persons.address.toast.delete_failed"))
    }
  }

  const handleEdit = () => {
    const selectedId = Object.keys(selectedRows)[0]
    navigate(`/persons/${personId}/edit-address/${selectedId}`)
  }

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

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const allSelected = addresses.reduce((acc: Record<string, boolean>, address) => {
        acc[address.id] = true
        return acc
      }, {} as Record<string, boolean>)
      setSelectedRows(allSelected)
    } else {
      setSelectedRows({})
    }
  }

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
    ],
    [selectedRows, t],
  )

  const table = useDataTable({
    columns,
    data: addresses,
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
          <CommandBar.Value>
            {Object.keys(selectedRows).length} selected
          </CommandBar.Value>
          <CommandBar.Command
            action={handleEdit}
            label="Edit"
            shortcut="e"
            disabled={Object.keys(selectedRows).length !== 1}
          />
          <CommandBar.Seperator />
          <CommandBar.Command action={handleDelete} label="Delete" shortcut="d" />
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
  )
}
;
