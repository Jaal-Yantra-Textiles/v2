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

  // Tags only need `id,*tags`. The default product fields (prices, designs,
  // raw materials) made this a second 1.5 MB fetch on top of the grid's, and
  // the two together pushed /store past Vercel's 10 s function limit.
  const [{ collections }, { response: { products } }] = await Promise.all([
    listCollections({
      fields: "*products",
    }),
    listProducts({
      pageParam: 1,
      queryParams: { limit: 100, fields: "id,*tags" },
      countryCode,
    }),
  ])

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
        {/* Floating AI search — a sticky pill centred over the catalogue.
            It stays centred while the customer scrolls and the results
            panel drops beneath it (see ai-search/index.tsx). */}
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
