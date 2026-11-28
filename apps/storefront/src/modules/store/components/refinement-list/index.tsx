"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect } from "react"

import SortProducts, { SortOptions } from "./sort-products"
import FilterRadioGroup from "./filter-radio-group"
import FilterCheckboxGroup from "./filter-checkbox-group"
import { HttpTypes } from "@medusajs/types"
import { Button, toast } from "@medusajs/ui"
import ActionSheet from "@modules/common/components/action-sheet"
import {
  closeFilterSheet,
  openFilterSheet,
  useFilterSheetOpen,
} from "./filter-sheet-store"

type RefinementListProps = {
  sortBy: SortOptions
  search?: boolean
  collections?: HttpTypes.StoreCollection[]
  tags?: HttpTypes.StoreProductTag[]
  /**
   * Drop the built-in full-width "Filters" button on mobile. Used by /store,
   * where the trigger lives in the search pill instead (see
   * `mobile-filter-trigger.tsx`); the ActionSheet itself stays here.
   */
  hideMobileTrigger?: boolean
  'data-testid'?: string
}

const RefinementList = ({ sortBy, collections, tags, hideMobileTrigger = false, 'data-testid': dataTestId }: RefinementListProps) => {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const filterOpen = useFilterSheetOpen()

  // The sheet flag is shared with the search-pill trigger, so reset it when
  // this component goes away — otherwise navigating back would re-open the
  // sheet and leave the page scroll-locked.
  useEffect(() => {
    return () => {
      closeFilterSheet()
      document.body.style.overflow = ""
    }
  }, [])


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

      {!hideMobileTrigger && (
        <div className="small:hidden mb-6 w-full px-6">
          <Button
            variant="secondary"
            className="w-full"
            onClick={openFilterSheet}
          >
            Filters
          </Button>
        </div>
      )}

      <ActionSheet
        open={filterOpen}
        onClose={closeFilterSheet}
        title="Filters"
        footer={
          <Button className="w-full" onClick={closeFilterSheet}>
            Close
          </Button>
        }
      >
        <FilterContent />
      </ActionSheet>
    </>
  )
}

export default RefinementList
