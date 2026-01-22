"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useCallback } from "react"

import SortProducts, { SortOptions } from "./sort-products"
import FilterRadioGroup from "./filter-radio-group"
import FilterCheckboxGroup from "./filter-checkbox-group"
import { HttpTypes } from "@medusajs/types"
import { Drawer, Button, clx, toast } from "@medusajs/ui"

type RefinementListProps = {
  sortBy: SortOptions
  search?: boolean
  collections?: HttpTypes.StoreCollection[]
  tags?: HttpTypes.StoreProductTag[]
  'data-testid'?: string
}



// ... (existing imports need to be preserved or re-imported if I overwrite them, so I should be careful)
// Actually, I can't easily preserve imports with replace_file_content if I don't see the top. 
// I will use reference to the file content I saw in step 126.

const RefinementList = ({ sortBy, collections, tags, 'data-testid': dataTestId }: RefinementListProps) => {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()


  const createQueryString = useCallback(
    (name: string, value: string) => {
      const params = new URLSearchParams(searchParams)
      params.set(name, value)
      return params.toString()
    },
    [searchParams]
  )

  const setQueryParams = (name: string, value: string) => {
    const query = createQueryString(name, value)
    router.push(`${pathname}?${query}`)
  }

  const handleCollectionChange = (value: string) => {
    // If the value is empty, or same as current, remove it.
    const currentCollection = searchParams.get("collection")

    if (!value || currentCollection === value) {
      const params = new URLSearchParams(searchParams)
      params.delete("collection")
      router.push(`${pathname}?${params.toString()}`)
      toast("Filters", {
        description: "Collection filter removed",
      })
    } else {
      setQueryParams("collection", value)
      toast("Filters", {
        description: "Collection filter applied",
      })
    }
  }

  const handleTagChange = (value: string) => {
    const currentTags = searchParams.get("tags")?.split(",") || []
    const newTags = currentTags.includes(value)
      ? currentTags.filter((t) => t !== value)
      : [...currentTags, value]

    setQueryParams("tags", newTags.join(","))
    toast("Filters", {
      description: "Tag filter updated",
    })
  }

  const selectedCollection = searchParams.get("collection") || ""
  const selectedTags = searchParams.get("tags")?.split(",") || []

  const FilterContent = () => (
    <div className="flex flex-col gap-8">
      <SortProducts sortBy={sortBy} setQueryParams={setQueryParams} data-testid={dataTestId} />

      {collections && collections.length > 0 && (
        <FilterRadioGroup
          title="Collections"
          items={collections.map((c) => ({ id: c.id, label: c.title, value: c.id }))}
          value={selectedCollection}
          onChange={handleCollectionChange}
        />
      )}

      {tags && tags.length > 0 && (
        <FilterCheckboxGroup
          title="Tags"
          items={tags.map((t) => ({ id: t.id, label: t.value, value: t.id }))}
          selected={selectedTags}
          onChange={handleTagChange}
        />
      )}
    </div>
  )

  return (
    <>
      <div className="hidden small:flex flex-col gap-8 py-4 mb-8 small:px-0 pl-6 small:min-w-[250px] small:ml-[1.675rem]">
        <FilterContent />
      </div>

      <div className="small:hidden mb-6 w-full px-6">
        <Drawer>
          <Drawer.Trigger asChild>
            <Button variant="secondary" className="w-full">Filters</Button>
          </Drawer.Trigger>
          <Drawer.Content className="max-h-[85vh] overflow-hidden">
            <Drawer.Header>
              <Drawer.Title>Filters</Drawer.Title>
            </Drawer.Header>
            <Drawer.Body className="p-6 overflow-y-auto">
              <FilterContent />
            </Drawer.Body>
            <Drawer.Footer>
              <Drawer.Close asChild>
                <Button className="w-full">Close</Button>
              </Drawer.Close>
            </Drawer.Footer>
          </Drawer.Content>
        </Drawer>
      </div>
    </>
  )
}

export default RefinementList
