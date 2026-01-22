"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useCallback } from "react"

import SortProducts, { SortOptions } from "./sort-products"
import FilterRadioGroup from "./filter-radio-group"
import FilterCheckboxGroup from "./filter-checkbox-group"
import { HttpTypes } from "@medusajs/types"

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
    setQueryParams("collection", value)
  }

  const handleTagChange = (value: string) => {
    const currentTags = searchParams.get("tags")?.split(",") || []
    const newTags = currentTags.includes(value)
      ? currentTags.filter((t) => t !== value)
      : [...currentTags, value]

    setQueryParams("tags", newTags.join(","))
  }

  const selectedCollection = searchParams.get("collection") || ""
  const selectedTags = searchParams.get("tags")?.split(",") || []

  return (
    <div className="flex flex-col gap-8 py-4 mb-8 small:px-0 pl-6 small:min-w-[250px] small:ml-[1.675rem]">
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
}

export default RefinementList
