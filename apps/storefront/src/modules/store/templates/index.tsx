import { Suspense } from "react"
import SkeletonProductGrid from "@modules/skeletons/templates/skeleton-product-grid"
import RefinementList from "@modules/store/components/refinement-list"
import { SortOptions } from "@modules/store/components/refinement-list/sort-products"
import StoreAiSearch from "@modules/store/components/ai-search"
import PaginatedProducts from "./paginated-products"
import { listCollections } from "@lib/data/collections"
import { listProducts } from "@lib/data/products"

const StoreTemplate = async ({
  sortBy,
  page,
  countryCode,
  collectionId,
  tagValues,
}: {
  sortBy?: SortOptions
  page?: string
  countryCode: string
  collectionId?: string
  tagValues?: string[]
}) => {
  const pageNumber = page ? parseInt(page) : 1
  const sort = sortBy || "created_at"

  const { collections } = await listCollections({
    fields: "*products",
  })

  const { response: { products } } = await listProducts({
    pageParam: 1,
    queryParams: { limit: 100 },
    countryCode,
  })

  // unique tags by id
  const tags = Array.from(new Map(products.flatMap((p) => p.tags?.map((t) => [t.id, t]) || [])).values())

  return (
    <div
      className="flex flex-col small:flex-row small:items-start py-6 content-container"
      data-testid="category-container"
    >
      <RefinementList sortBy={sort} collections={collections} tags={tags} />
      <div className="flex-1 w-full relative">
        <div className="mb-6 text-2xl-semi">
          <h1 data-testid="store-page-title">All products</h1>
        </div>
        <StoreAiSearch />
        <Suspense fallback={<SkeletonProductGrid />}>
          <PaginatedProducts
            sortBy={sort}
            page={pageNumber}
            countryCode={countryCode}
            collectionId={collectionId}
            tagValues={tagValues}
          />
        </Suspense>
      </div>
    </div>
  )
}

export default StoreTemplate
