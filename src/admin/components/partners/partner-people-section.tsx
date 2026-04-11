import {
  Badge,
  Button,
  Checkbox,
  Container,
  FocusModal,
  Heading,
  Input,
  Text,
  toast,
  usePrompt,
} from "@medusajs/ui"
import { Plus, Trash, Users } from "@medusajs/icons"
import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { ActionMenu } from "../common/action-menu"
import {
  usePartnerPeople,
  useUnlinkPeopleFromPartner,
  useLinkPeopleToPartner,
  PartnerPerson,
} from "../../hooks/api/partner-people"
import { usePersons } from "../../hooks/api/persons"

interface PartnerPeopleSectionProps {
  partnerId: string
}

export const PartnerPeopleSection = ({
  partnerId,
}: PartnerPeopleSectionProps) => {
  const [linkModalOpen, setLinkModalOpen] = useState(false)
  const { people, isLoading } = usePartnerPeople(partnerId)
  const unlinkMutation = useUnlinkPeopleFromPartner(partnerId)
  const prompt = usePrompt()

  const handleUnlink = async (person: PartnerPerson) => {
    const confirmed = await prompt({
      title: "Remove Person",
      description: `Remove ${person.first_name} ${person.last_name} from this partner? They will lose access to shared folders.`,
      confirmText: "Remove",
      cancelText: "Cancel",
    })

    if (!confirmed) return

    await unlinkMutation.mutateAsync(
      { person_ids: [person.id] },
      {
        onSuccess: () => {
          toast.success(
            `${person.first_name} ${person.last_name} removed from partner`
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
            <Heading level="h2">People</Heading>
            {people.length > 0 && (
              <Badge size="2xsmall" color="grey">
                {people.length}
              </Badge>
            )}
          </div>
          <Button
            variant="secondary"
            size="small"
            onClick={() => setLinkModalOpen(true)}
          >
            <Plus />
            Link Person
          </Button>
        </div>

        {isLoading ? (
          <div className="px-6 py-8 text-center">
            <Text size="small" className="text-ui-fg-muted">
              Loading...
            </Text>
          </div>
        ) : people.length === 0 ? (
          <div className="flex flex-col items-center gap-y-2 px-6 py-8">
            <Users className="text-ui-fg-muted" />
            <Text
              size="small"
              leading="compact"
              weight="plus"
              className="text-ui-fg-subtle"
            >
              No people linked
            </Text>
            <Text size="small" className="text-ui-fg-muted text-center">
              Link people to this partner so they can access shared folders and
              upload files through the partner portal.
            </Text>
          </div>
        ) : (
          <div className="flex flex-col">
            {people.map((person) => (
              <div
                key={person.id}
                className="flex items-center justify-between px-6 py-3 border-b border-ui-border-base last:border-b-0"
              >
                <div className="flex flex-col">
                  <Link
                    to={`/persons/${person.id}`}
                    className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover"
                  >
                    <Text size="small" weight="plus">
                      {person.first_name} {person.last_name}
                    </Text>
                  </Link>
                  <div className="flex items-center gap-x-2">
                    {person.email && (
                      <Text size="xsmall" className="text-ui-fg-muted">
                        {person.email}
                      </Text>
                    )}
                    {person.state && (
                      <Badge size="2xsmall" color="grey">
                        {person.state}
                      </Badge>
                    )}
                  </div>
                </div>
                <ActionMenu
                  groups={[
                    {
                      actions: [
                        {
                          label: "Remove",
                          icon: <Trash />,
                          onClick: () => handleUnlink(person),
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

      <LinkPersonToPartnerModal
        partnerId={partnerId}
        open={linkModalOpen}
        onOpenChange={setLinkModalOpen}
        existingPersonIds={people.map((p) => p.id)}
      />
    </>
  )
}

// ── Modal to search and link existing persons ──

interface LinkPersonToPartnerModalProps {
  partnerId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  existingPersonIds: string[]
}

const LinkPersonToPartnerModal = ({
  partnerId,
  open,
  onOpenChange,
  existingPersonIds,
}: LinkPersonToPartnerModalProps) => {
  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState<Record<string, boolean>>({})

  const { persons = [], isLoading } = usePersons(
    { limit: 50, ...(search ? { q: search } : {}) },
    { enabled: open }
  )

  const linkMutation = useLinkPeopleToPartner(partnerId)

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

  const handleLink = async () => {
    const personIds = Object.entries(selected)
      .filter(([, v]) => v)
      .map(([k]) => k)

    if (!personIds.length) return

    await linkMutation.mutateAsync(
      { person_ids: personIds },
      {
        onSuccess: () => {
          toast.success(`${personIds.length} person(s) linked to partner`)
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
          <Heading>Link People to Partner</Heading>
        </FocusModal.Header>

        <FocusModal.Body className="flex flex-col gap-y-4 p-6 overflow-y-auto">
          <Text size="small" className="text-ui-fg-subtle">
            Select existing people to link to this partner. Linked people can
            access shared folders and upload files through the partner portal.
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
                            (already linked)
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
            onClick={handleLink}
            disabled={selectedCount === 0}
            isLoading={linkMutation.isPending}
          >
            Link {selectedCount > 0 ? `(${selectedCount})` : ""}
          </Button>
        </div>
      </FocusModal.Content>
    </FocusModal>
  )
}
