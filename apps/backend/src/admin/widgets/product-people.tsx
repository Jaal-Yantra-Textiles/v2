import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Container, Text, Avatar, Skeleton, Badge } from "@medusajs/ui"
import { DetailWidgetProps } from "@medusajs/framework/types"
import { useProduct, useUnlinkProductPerson } from "../hooks/api/products"
import { ActionMenu } from "../components/common/action-menu"
import { Trash } from "@medusajs/icons"

type Person = {
  id: string
  first_name?: string | null
  last_name?: string | null
  email?: string | null
  avatar_url?: string | null
}

type PartnerWithPeople = {
  id: string
  name?: string
  people?: Person[]
}

type DesignWithPartners = {
  id: string
  name: string
  partners?: PartnerWithPeople[]
}

type ProductData = {
  id: string
  people?: Person[]
  designs?: DesignWithPartners[]
}

const ProductPeopleWidget = ({ data }: DetailWidgetProps<ProductData>) => {
  const productId = typeof data === "string" ? data : data?.id

  const { product, isPending, isError, error } = (useProduct(
    productId!,
    {
      // Fetch nested relations through module links and direct people
      fields: "+people.*,+designs.*,+designs.partners.*,+designs.partners.people.*",
    }
  ) as unknown) as {
    product?: ProductData
    isPending: boolean
    isError: boolean
    error?: Error
  }

  const unlinkPersonMutation = useUnlinkProductPerson()

  // Aggregate unique people from all linked designs' partners
  const indirectPeople: Person[] = (() => {
    const map = new Map<string, Person>()
    const designs = product?.designs || []
    for (const d of designs) {
      const partners = d.partners || []
      for (const p of partners) {
        const persons = p.people || []
        for (const person of persons) {
          if (person?.id && !map.has(person.id)) {
            map.set(person.id, person)
          }
        }
      }
    }
    return Array.from(map.values())
  })()

  const directPeople: Person[] = Array.from(
    new Map((product?.people || []).map((p) => [p.id, p])).values()
  )

  // Ensure indirect excludes any directly linked duplicates
  const indirectOnly: Person[] = indirectPeople.filter((p) => !directPeople.find((d) => d.id === p.id))

  if (isPending) {
    return <Skeleton className="h-32" />
  }

  if (isError) {
    return (
      <Container className="divide-y p-0">
        <div className="flex items-center justify-center h-32 px-6 py-4">
          <Text className="text-ui-fg-error">{error?.message || "Failed to load people"}</Text>
        </div>
      </Container>
    )
  }

  return (
    <Container className="divide-y p-0">
      {/* Header */}
      <div className="px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-x-2">
          <Text size="large" className="mb-1">People</Text>
          {(directPeople.length + indirectOnly.length) > 0 && (
            <Badge size="2xsmall" color="blue">{directPeople.length + indirectOnly.length}</Badge>
          )}
        </div>
        <ActionMenu
          groups={[
            {
              actions: [
                { label: "Link People", to: `/products/${productId}/link-people`, icon: undefined },
              ],
            },
          ]}
        />
      </div>

      {/* Manually Linked Section */}
      <div className="px-6 py-4">
        <div className="flex items-center gap-x-2 mb-2">
          <Text weight="plus">Manually Linked</Text>
          {directPeople.length > 0 && (
            <Badge size="2xsmall" color="blue">{directPeople.length}</Badge>
          )}
        </div>
        {directPeople.length === 0 ? (
          <Text className="text-ui-fg-subtle">No manually linked people.</Text>
        ) : (
          <div className="flex flex-col gap-y-3">
            {directPeople.map((person) => {
              const name = [person.first_name, person.last_name].filter(Boolean).join(" ") || person.email || person.id
              return (
                <div key={person.id} className="flex items-center justify-between gap-x-3">
                  <div className="flex items-center gap-x-3">
                    <Avatar src={person.avatar_url || undefined} fallback={name.charAt(0)} />
                    <div className="flex flex-col">
                      <Text weight="plus">{name}</Text>
                      {person.email && <Text size="small" className="text-ui-fg-subtle">{person.email}</Text>}
                    </div>
                  </div>
                  <ActionMenu
                    groups={[
                      {
                        actions: [
                          {
                            label: "Unlink",
                            icon: <Trash />,
                            onClick: async () => {
                              await unlinkPersonMutation.mutateAsync({
                                productId: productId!,
                                payload: { personId: person.id },
                              })
                            },
                          },
                        ],
                      },
                    ]}
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Via Linked Designs Section (read-only) */}
      <div className="px-6 py-4">
        <div className="flex items-center gap-x-2 mb-2">
          <Text weight="plus">Via Linked Designs (read-only)</Text>
          {indirectOnly.length > 0 && (
            <Badge size="2xsmall" color="blue">{indirectOnly.length}</Badge>
          )}
        </div>
        {indirectOnly.length === 0 ? (
          <Text className="text-ui-fg-subtle">No people found via linked designs.</Text>
        ) : (
          <div className="flex flex-col gap-y-3">
            {indirectOnly.map((person) => {
              const name = [person.first_name, person.last_name].filter(Boolean).join(" ") || person.email || person.id
              return (
                <div key={person.id} className="flex items-center gap-x-3">
                  <Avatar src={person.avatar_url || undefined} fallback={name.charAt(0)} />
                  <div className="flex flex-col">
                    <Text weight="plus">{name}</Text>
                    {person.email && <Text size="small" className="text-ui-fg-subtle">{person.email}</Text>}
                  </div>
                  <Badge size="2xsmall" color="grey">via Design</Badge>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "product.details.after",
})

export default ProductPeopleWidget
