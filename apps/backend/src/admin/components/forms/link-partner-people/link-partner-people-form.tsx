import { useMemo, useState } from "react"
import { Button, Checkbox, Heading, Input, Text, toast } from "@medusajs/ui"

import { useModalChrome } from "../../modal/chrome/use-modal-chrome"
import {
  usePartnerPeople,
  useLinkPeopleToPartner,
} from "../../../hooks/api/partner-people"
import { usePersons } from "../../../hooks/api/persons"

/**
 * Link existing people to a partner.
 *
 * Lifted out of the `FocusModal` inside `PartnerPeopleSection` so the partner
 * graph can open the same form the section does — chrome and "done" come from
 * whichever shell wraps it (#1856).
 *
 * 🔴 It fetches the partner's CURRENT people itself rather than taking them as
 * a prop. The section had them to hand; the graph does not — its `people` node
 * carries a count, not the rows. Taking them as a prop would have meant the
 * graph passing `[]`, and every already-linked person would have rendered as
 * selectable, offering a link that silently duplicates a row.
 *
 * 🔴 It stays OPEN after a successful link, the same as the design's partner
 * form. Linking people is a repeated gesture, and the count behind it updates
 * on close.
 */
export const LinkPartnerPeopleForm = ({
  partnerId,
}: {
  partnerId: string
}) => {
  const Chrome = useModalChrome()
  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState<Record<string, boolean>>({})

  const { people } = usePartnerPeople(partnerId)
  const { persons = [], isLoading } = usePersons({
    limit: 50,
    ...(search ? { q: search } : {}),
  })

  const linkMutation = useLinkPeopleToPartner(partnerId)

  const existingSet = useMemo(
    () => new Set((people || []).map((p) => p.id)),
    [people]
  )

  const selectedIds = useMemo(
    () => Object.keys(selected).filter((k) => selected[k]),
    [selected]
  )

  const handleLink = async () => {
    if (!selectedIds.length) {
      return
    }
    await linkMutation.mutateAsync(
      { person_ids: selectedIds },
      {
        onSuccess: () => {
          toast.success(
            `${selectedIds.length} ${
              selectedIds.length === 1 ? "person" : "people"
            } linked`
          )
          setSelected({})
        },
        onError: (error) => {
          toast.error(error.message || "The people could not be linked")
        },
      }
    )
  }

  return (
    <>
      <Chrome.Header>
        <div>
          <Chrome.Title asChild>
            <Heading>Link people</Heading>
          </Chrome.Title>
          <Text size="small" className="text-ui-fg-subtle">
            Linked people can reach shared folders and upload through the
            partner portal.
          </Text>
        </div>
      </Chrome.Header>

      <Chrome.Body className="flex flex-1 flex-col gap-y-4 overflow-y-auto px-6 py-6">
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
          <div className="border-ui-border-base flex flex-col divide-y rounded-lg border">
            {persons.map((person: any) => {
              const isExisting = existingSet.has(person.id)
              return (
                <label
                  key={person.id}
                  className="hover:bg-ui-bg-base-hover flex cursor-pointer items-center gap-x-3 px-4 py-3"
                >
                  <Checkbox
                    checked={!!selected[person.id]}
                    disabled={isExisting}
                    onCheckedChange={() =>
                      setSelected((prev) => ({
                        ...prev,
                        [person.id]: !prev[person.id],
                      }))
                    }
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
      </Chrome.Body>

      <Chrome.Footer>
        <div className="flex w-full items-center justify-end gap-x-2">
          <Chrome.Close asChild>
            <Button variant="secondary" size="small">
              Cancel
            </Button>
          </Chrome.Close>
          <Button
            size="small"
            onClick={handleLink}
            disabled={selectedIds.length === 0}
            isLoading={linkMutation.isPending}
          >
            Link {selectedIds.length > 0 ? `(${selectedIds.length})` : ""}
          </Button>
        </div>
      </Chrome.Footer>
    </>
  )
}
