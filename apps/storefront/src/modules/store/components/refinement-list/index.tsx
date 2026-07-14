"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useCallback } from "react"

import SortProducts, { SortOptions } from "./sort-products"
import FilterRadioGroup from "./filter-radio-group"
import FilterCheckboxGroup from "./filter-checkbox-group"
import { HttpTypes } from "@medusajs/types"
import { Button, toast } from "@medusajs/ui"
import { useState } from "react"
import ActionSheet from "@modules/common/components/action-sheet"

type RefinementListProps = {
  sortBy: SortOptions
  search?: boolean
  collections?: HttpTypes.StoreCollection[]
  tags?: HttpTypes.StoreProductTag[]
  'data-testid'?: string
}

const RefinementList = ({ sortBy, collections, tags, 'data-testid': dataTestId }: RefinementListProps) => {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [filterOpen, setFilterOpen] = useState(false)


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
        <Button
          variant="secondary"
          className="w-full"
          onClick={() => setFilterOpen(true)}
        >
          Filters
        </Button>
        <ActionSheet
          open={filterOpen}
          onClose={() => setFilterOpen(false)}
          title="Filters"
          footer={
            <Button className="w-full" onClick={() => setFilterOpen(false)}>
              Close
            </Button>
          }
        >
          <FilterContent />
        </ActionSheet>
      </div>
    </>
  )
}

export default RefinementList
