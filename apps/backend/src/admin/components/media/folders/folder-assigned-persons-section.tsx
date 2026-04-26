import { Container, Heading, Text, Button, Badge, toast, usePrompt } from "@medusajs/ui"
import { Plus, Trash, Users } from "@medusajs/icons"
import { useState } from "react"
import { ActionMenu } from "../../common/action-menu"
import {
  useFolderPersons,
  useUnassignPersonsFromFolder,
  AssignedPerson,
} from "../../../hooks/api/folder-persons"
import { AssignPersonsModal } from "./assign-persons-modal"

interface FolderAssignedPersonsSectionProps {
  folderId: string
}

export const FolderAssignedPersonsSection = ({
  folderId,
}: FolderAssignedPersonsSectionProps) => {
  const [assignModalOpen, setAssignModalOpen] = useState(false)
  const { persons, isLoading } = useFolderPersons(folderId)
  const unassignMutation = useUnassignPersonsFromFolder(folderId)
  const prompt = usePrompt()

  const handleUnassign = async (person: AssignedPerson) => {
    const confirmed = await prompt({
      title: "Remove Person",
      description: `Remove ${person.first_name} ${person.last_name} from this folder? They will lose upload access.`,
      confirmText: "Remove",
      cancelText: "Cancel",
    })

    if (!confirmed) return

    await unassignMutation.mutateAsync(
      { person_ids: [person.id] },
      {
        onSuccess: () => {
          toast.success(
            `${person.first_name} ${person.last_name} removed from folder`
          )
        },
        onError: (error) => {
          toast.error(error.message)
        },
      }
    )
  }

  return (
    <>
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-x-2">
            <Heading level="h2">Assigned People</Heading>
            {persons.length > 0 && (
              <Badge size="2xsmall" color="grey">
                {persons.length}
              </Badge>
            )}
          </div>
          <Button
            variant="secondary"
            size="small"
            onClick={() => setAssignModalOpen(true)}
          >
            <Plus />
            Assign
          </Button>
        </div>

        {isLoading ? (
          <div className="px-6 py-8 text-center">
            <Text size="small" className="text-ui-fg-muted">
              Loading...
            </Text>
          </div>
        ) : persons.length === 0 ? (
          <div className="flex flex-col items-center gap-y-2 px-6 py-8">
            <Users className="text-ui-fg-muted" />
            <Text
              size="small"
              leading="compact"
              weight="plus"
              className="text-ui-fg-subtle"
            >
              No people assigned
            </Text>
            <Text size="small" className="text-ui-fg-muted">
              Assign people to let them upload files and leave comments via the
              partner portal.
            </Text>
          </div>
        ) : (
          <div className="flex flex-col">
            {persons.map((person) => (
              <div
                key={person.id}
                className="flex items-center justify-between px-6 py-3 border-b border-ui-border-base last:border-b-0"
              >
                <div className="flex flex-col">
                  <Text size="small" weight="plus">
                    {person.first_name} {person.last_name}
                  </Text>
                  {person.email && (
                    <Text size="xsmall" className="text-ui-fg-muted">
                      {person.email}
                    </Text>
                  )}
                </div>
                <ActionMenu
                  groups={[
                    {
                      actions: [
                        {
                          label: "Remove",
                          icon: <Trash />,
                          onClick: () => handleUnassign(person),
                        },
                      ],
                    },
                  ]}
                />
              </div>
            ))}
          </div>
        )}
      </Container>

      <AssignPersonsModal
        folderId={folderId}
        open={assignModalOpen}
        onOpenChange={setAssignModalOpen}
        existingPersonIds={persons.map((p) => p.id)}
      />
    </>
  )
}
