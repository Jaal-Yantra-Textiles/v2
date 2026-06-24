"use client"

import Back from "@modules/common/icons/back"
import FastDelivery from "@modules/common/icons/fast-delivery"
import Refresh from "@modules/common/icons/refresh"

import Accordion from "./accordion"
import RawMaterialsTab from "../../templates/raw-material"
import { HttpTypes } from "@medusajs/types"
import { StoreDesign } from "../../../../types/product-design"
import type { ProductionStory } from "@lib/data/designs"
import { humanizeStatus, nonZeroConsumptionMetrics } from "../production-story/lib"

interface ProductWithDesigns extends HttpTypes.StoreProduct {
  designs?: StoreDesign[]
}

type ProductTabsProps = {
  product: ProductWithDesigns
  /** v2 production story (money-free) — powers the "Crafted by" tab. */
  story?: ProductionStory | null
}

const ProductTabs = ({ product, story }: ProductTabsProps) => {
  const inventory_items = product.designs?.[0]?.inventory_items || []
  const people = story?.people ?? []
  const partners = (story?.partners ?? []).filter((p) => p.name?.trim())
  const hasCraftedBy = people.length > 0 || partners.length > 0

  const energyMetrics = nonZeroConsumptionMetrics(story)
  const producedTotal = (story?.runs ?? []).reduce(
    (sum, r) => sum + (typeof r.produced_quantity === "number" ? r.produced_quantity : 0),
    0
  )
  const consumed = story?.consumption?.materials_consumed ?? []
  const hasEnergyOutput =
    energyMetrics.length > 0 || producedTotal > 0 || consumed.length > 0

  const tabs = [
    {
      label: "Material Used",
      component: <RawMaterialsTab inventory_items={inventory_items} />,
    },
    ...(hasCraftedBy
      ? [
          {
            label: "Crafted by",
            component: <CraftedByTab people={people} partners={partners} />,
          },
        ]
      : []),
    ...(hasEnergyOutput
      ? [
          {
            label: "How much environmental cost for this design?",
            component: (
              <EnergyOutputTab
                metrics={energyMetrics}
                produced={producedTotal}
                consumed={consumed}
              />
            ),
          },
        ]
      : []),
    {
      label: "Product Information",
      component: <ProductInfoTab product={product} />,
    },
    {
      label: "Shipping & Returns",
      component: <ShippingInfoTab />,
    },
  ]

  return (
    <div className="w-full">
      <Accordion type="multiple">
        {tabs.map((tab, i) => (
          <Accordion.Item
            key={i}
            title={tab.label}
            headingSize="medium"
            value={tab.label}
          >
            {tab.component}
          </Accordion.Item>
        ))}
      </Accordion>
    </div>
  )
}

const ProductInfoTab = ({ product }: ProductTabsProps) => {
  return (
    <div className="text-small-regular py-8">
      <div className="grid grid-cols-2 gap-x-8">
        <div className="flex flex-col gap-y-4">
          <div>
            <span className="font-semibold">Material</span>
            <p>{product.material ? product.material : "-"}</p>
          </div>
          <div>
            <span className="font-semibold">Country of origin</span>
            <p>{product.origin_country ? product.origin_country : "-"}</p>
          </div>
          <div>
            <span className="font-semibold">Type</span>
            <p>{product.type ? product.type.value : "-"}</p>
          </div>
        </div>
        <div className="flex flex-col gap-y-4">
          <div>
            <span className="font-semibold">Weight</span>
            <p>{product.weight ? `${product.weight} g` : "-"}</p>
          </div>
          <div>
            <span className="font-semibold">Dimensions</span>
            <p>
              {product.length && product.width && product.height
                ? `${product.length}L x ${product.width}W x ${product.height}H`
                : "-"}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

const ShippingInfoTab = () => {
  return (
    <div className="text-small-regular py-8">
      <div className="grid grid-cols-1 gap-y-8">
        <div className="flex items-start gap-x-2">
          <FastDelivery />
          <div>
            <span className="font-semibold">Fast delivery</span>
            <p className="max-w-sm">
              Your package will arrive in 3-5 business days at your pick up
              location or in the comfort of your home.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-x-2">
          <Refresh />
          <div>
            <span className="font-semibold">Simple exchanges</span>
            <p className="max-w-sm">
              Is the fit not quite right? No worries - we&apos;ll exchange your
              product for a new one.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-x-2">
          <Back />
          <div>
            <span className="font-semibold">Easy returns</span>
            <p className="max-w-sm">
              Just return your product and we&apos;ll refund your money. No
              questions asked – we&apos;ll do our best to make sure your return
              is hassle-free.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

const CraftedByTab = ({
  people,
  partners,
}: {
  people: NonNullable<ProductionStory["people"]>
  partners: NonNullable<ProductionStory["partners"]>
}) => {
  return (
    <div className="text-small-regular flex flex-col gap-y-6 py-8">
      {people.length > 0 && (
        <div className="flex flex-col gap-y-2">
          <span className="font-semibold">People who made it</span>
          {people.map((person) => (
            <div key={person.id} className="text-ui-fg-subtle">
              {person.name}
              {person.role ? ` · ${humanizeStatus(person.role)}` : ""}
            </div>
          ))}
        </div>
      )}
      {partners.length > 0 && (
        <div className="flex flex-col gap-y-2">
          <span className="font-semibold">Partners</span>
          <div className="text-ui-fg-subtle">
            {partners.map((p) => p.name).filter(Boolean).join(", ")}
          </div>
        </div>
      )}
    </div>
  )
}

// Energy & output — money-free sustainability view: energy/labor used,
// units produced, and raw materials consumed during production.
const EnergyOutputTab = ({
  metrics,
  produced,
  consumed,
}: {
  metrics: { label: string; value: string }[]
  produced: number
  consumed: NonNullable<ProductionStory["consumption"]>["materials_consumed"]
}) => {
  return (
    <div className="text-small-regular flex flex-col gap-y-6 py-8">
      {metrics.length > 0 && (
        <div className="flex flex-col gap-y-2">
          <span className="font-semibold">Energy &amp; labor used</span>
          {metrics.map((m) => (
            <div key={m.label} className="text-ui-fg-subtle">
              {m.label}: {m.value}
            </div>
          ))}
        </div>
      )}
      {produced > 0 && (
        <div className="flex flex-col gap-y-1">
          <span className="font-semibold">Output</span>
          <div className="text-ui-fg-subtle">
            {produced} unit{produced === 1 ? "" : "s"} produced
          </div>
        </div>
      )}
      {consumed.length > 0 && (
        <div className="flex flex-col gap-y-2">
          <span className="font-semibold">Materials consumed</span>
          {consumed.map((c, i) => (
            <div key={c.raw_material_id ?? i} className="text-ui-fg-subtle">
              {c.name || "Material"}: {c.quantity} {c.unit_of_measure}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default ProductTabs
