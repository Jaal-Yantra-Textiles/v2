import {
  Button,
  Checkbox,
  FocusModal,
  Heading,
  Text,
  toast,
  Input,
} from "@medusajs/ui"
import { useState, useMemo } from "react"
import { usePersons } from "../../../hooks/api/persons"
import { useAssignPersonsToFolder } from "../../../hooks/api/folder-persons"

interface AssignPersonsModalProps {
  folderId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  existingPersonIds: string[]
}

export const AssignPersonsModal = ({
  folderId,
  open,
  onOpenChange,
  existingPersonIds,
}: AssignPersonsModalProps) => {
  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState<Record<string, boolean>>({})

  const { persons = [], isLoading } = usePersons(
    { limit: 50, ...(search ? { q: search } : {}) },
    { enabled: open }
  )

  const assignMutation = useAssignPersonsToFolder(folderId)

  const existingSet = useMemo(
    () => new Set(existingPersonIds),
    [existingPersonIds]
  )

  const selectedCount = useMemo(
    () => Object.values(selected).filter(Boolean).length,
    [selected]
  )

  const togglePerson = (id: string) => {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const handleAssign = async () => {
    const personIds = Object.entries(selected)
      .filter(([, v]) => v)
      .map(([k]) => k)

    if (!personIds.length) return

    await assignMutation.mutateAsync(
      { person_ids: personIds },
      {
        onSuccess: () => {
          toast.success(`${personIds.length} person(s) assigned to folder`)
          setSelected({})
          onOpenChange(false)
        },
        onError: (error) => {
          toast.error(error.message)
        },
      }
    )
  }

  const handleClose = () => {
    setSelected({})
    setSearch("")
    onOpenChange(false)
  }

  return (
    <FocusModal open={open} onOpenChange={handleClose}>
      <FocusModal.Content>
        <FocusModal.Header>
          <Heading>Assign People to Folder</Heading>
        </FocusModal.Header>

        <FocusModal.Body className="flex flex-col gap-y-4 p-6 overflow-y-auto">
          <Text size="small" className="text-ui-fg-subtle">
            Select people to grant upload and comment access through the partner
            portal. They must be linked to a partner to sign in.
          </Text>

          <Input
            placeholder="Search people..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            size="small"
          />

          {isLoading ? (
            <div className="py-8 text-center">
              <Text size="small" className="text-ui-fg-muted">
                Loading...
              </Text>
            </div>
          ) : persons.length === 0 ? (
            <div className="py-8 text-center">
              <Text size="small" className="text-ui-fg-muted">
                No people found
              </Text>
            </div>
          ) : (
            <div className="flex flex-col divide-y border rounded-lg border-ui-border-base">
              {persons.map((person: any) => {
                const isExisting = existingSet.has(person.id)
                const isChecked = !!selected[person.id]

                return (
                  <label
                    key={person.id}
                    className="flex items-center gap-x-3 px-4 py-3 cursor-pointer hover:bg-ui-bg-base-hover"
                  >
                    <Checkbox
                      checked={isChecked}
                      disabled={isExisting}
                      onCheckedChange={() => togglePerson(person.id)}
                    />
                    <div className="flex flex-col">
                      <Text size="small" weight="plus">
                        {person.first_name} {person.last_name}
                        {isExisting && (
                          <span className="text-ui-fg-muted ml-2">
                            (already assigned)
                          </span>
                        )}
                      </Text>
                      {person.email && (
                        <Text size="xsmall" className="text-ui-fg-muted">
                          {person.email}
                        </Text>
                      )}
                    </div>
                  </label>
                )
              })}
            </div>
          )}
        </FocusModal.Body>

        <div className="flex items-center justify-end gap-x-2 border-t border-ui-border-base px-6 py-4">
          <Button variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={handleAssign}
            disabled={selectedCount === 0}
            isLoading={assignMutation.isPending}
          >
            Assign {selectedCount > 0 ? `(${selectedCount})` : ""}
          </Button>
        </div>
      </FocusModal.Content>
    </FocusModal>
  )
}
