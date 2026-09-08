import {
  Badge,
  Button,
  Container,
  FocusModal,
  Heading,
  Text,
  toast,
  usePrompt,
} from "@medusajs/ui"
import { Plus, Trash, Users } from "@medusajs/icons"
import { useState } from "react"
import { Link } from "react-router-dom"
import { ActionMenu } from "../common/action-menu"
import {
  usePartnerPeople,
  useUnlinkPeopleFromPartner,
  PartnerPerson,
} from "../../hooks/api/partner-people"
import { LinkPartnerPeopleForm } from "../forms/link-partner-people/link-partner-people-form"
import { DrawerChromeProvider } from "../modal/chrome/route-chrome-provider"

interface PartnerPeopleSectionProps {
  partnerId: string
}

export const PartnerPeopleSection = ({
  partnerId,
}: PartnerPeopleSectionProps) => {
  const [linkModalOpen, setLinkModalOpen] = useState(false)
  const { people, isLoading, dangling } = usePartnerPeople(partnerId)
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
            {/*
              🔴 Say it, rather than let "none" stand for two different facts.
              This partner HAS link rows — they point at people that no longer
              exist (#1857). Before the null filter went in, those rows took
              the whole page down; silently rendering "No people linked" over
              them would trade a crash for a quieter untruth, which is the
              exact failure this graph work exists to remove.
            */}
            {dangling > 0 && (
              <Text size="xsmall" className="text-ui-fg-muted text-center">
                {dangling} link {dangling === 1 ? "row points" : "rows point"} at
                a person that no longer exists, and {dangling === 1 ? "was" : "were"}{" "}
                left out.
              </Text>
            )}
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
      />
    </>
  )
}

// ── Modal to search and link existing persons ──

/**
 * 🔴 The shell only. The form inside it lives in
 * `components/forms/link-partner-people` so the partner graph opens the same
 * one this section does (#1856). Before that split this modal WAS the form,
 * which is why the graph's `people` node could list who was linked and offer
 * no way to link anybody.
 */
const LinkPersonToPartnerModal = ({
  partnerId,
  open,
  onOpenChange,
}: {
  partnerId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) => {
  return (
    <FocusModal open={open} onOpenChange={onOpenChange}>
      <FocusModal.Content>
        <DrawerChromeProvider
          parts={{
            Header: FocusModal.Header,
            Title: FocusModal.Title,
            Description: FocusModal.Description,
            Body: FocusModal.Body,
            Footer: FocusModal.Footer,
            Close: FocusModal.Close,
          }}
          onClose={() => onOpenChange(false)}
        >
          <LinkPartnerPeopleForm partnerId={partnerId} />
        </DrawerChromeProvider>
      </FocusModal.Content>
    </FocusModal>
  )
}
