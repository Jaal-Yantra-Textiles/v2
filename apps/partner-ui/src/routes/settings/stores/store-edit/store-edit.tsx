import { Button, Heading, Input, Label, toast } from "@medusajs/ui"
import { useState } from "react"

import { RouteDrawer, useRouteModal } from "../../../../components/modals"
import { usePartnerStores, useUpdatePartnerStore } from "../../../../hooks/api/partner-stores"

export const StoreEdit = () => {
  const { stores, isPending: isLoading } = usePartnerStores()
  const store = stores?.[0]

  if (isLoading || !store) {
    return (
      <RouteDrawer>
        <RouteDrawer.Header>
          <Heading>Edit Store</Heading>
        </RouteDrawer.Header>
        <RouteDrawer.Body>
          <div className="h-32" />
        </RouteDrawer.Body>
      </RouteDrawer>
    )
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <Heading>Edit Store</Heading>
      </RouteDrawer.Header>
      <StoreEditForm store={store} />
    </RouteDrawer>
  )
}

const StoreEditForm = ({ store }: { store: any }) => {
  const { handleSuccess } = useRouteModal()

  const [name, setName] = useState(store.name || "")

  const { mutateAsync: updateStore, isPending: isSaving } = useUpdatePartnerStore(store.id, {
    onSuccess: () => {
      toast.success("Store updated")
      handleSuccess()
    },
    onError: (err) => {
      toast.error(err?.message || "Failed to update store")
    },
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await updateStore({ name: name.trim() || undefined })
  }

  return (
    <form onSubmit={handleSubmit}>
      <RouteDrawer.Body>
        <div className="flex flex-col gap-y-4">
          <div className="flex flex-col gap-y-2">
            <Label size="xsmall" htmlFor="store-name">Store Name</Label>
            <Input
              id="store-name"
              size="small"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Store"
            />
          </div>
        </div>
      </RouteDrawer.Body>
      <RouteDrawer.Footer>
        <div className="flex items-center justify-end gap-x-2">
          <RouteDrawer.Close asChild>
            <Button variant="secondary" size="small">
              Cancel
            </Button>
          </RouteDrawer.Close>
          <Button
            type="submit"
            size="small"
            isLoading={isSaving}
            disabled={!name.trim()}
          >
            Save
          </Button>
        </div>
      </RouteDrawer.Footer>
    </form>
  )
}
