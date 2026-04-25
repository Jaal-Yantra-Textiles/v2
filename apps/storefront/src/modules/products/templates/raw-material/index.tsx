import { Text } from "@medusajs/ui"
import {
  StoreInventoryItem,
  StoreRawMaterial,
} from "../../../../types/product-design"

type RawMaterialsTabProps = {
  inventory_items?: StoreInventoryItem[]
}

const RawMaterialsTab = ({ inventory_items }: RawMaterialsTabProps) => {
  const inventoryItems = inventory_items || []

  return (
    <div className="text-small-regular py-8">
      {inventoryItems.length > 0 ? (
        <div className="flex flex-col gap-y-6">
          {inventoryItems.map((item) => (
            <div key={item.id}>
              {item.raw_materials && (
                <div key={item.raw_materials.id}>
                  <Text className="text-large-semi mb-2">
                    {item.raw_materials.name}
                  </Text>
                  <Text className="text-small-regular text-ui-fg-subtle mb-4">
                    {item.raw_materials.description}
                  </Text>
                  <div className="text-small-regular py-8">
                    <div className="grid grid-cols-2 gap-x-8">
                      <div className="flex flex-col gap-y-4">
                        <div>
                          <span className="font-semibold">Material</span>
                          <p>
                            {item.raw_materials.material_type.name} (
                            {item.raw_materials.material_type.category})
                          </p>
                        </div>
                        <div>
                          <span className="font-semibold">SKU</span>
                          <p>{item.raw_materials.sku || "-"}</p>
                        </div>
                        <div>
                          <span className="font-semibold">Color</span>
                          <div className="flex items-center gap-x-2">
                            <div
                              className="w-4 h-4 rounded-full border"
                              style={{
                                backgroundColor:
                                  item.raw_materials.color || undefined,
                              }}
                            ></div>
                            <p>{item.raw_materials.color || "-"}</p>
                          </div>
                        </div>
                        <div>
                          <span className="font-semibold">Country of Origin</span>
                          <p>{item.raw_materials.country_of_origin || "-"}</p>
                        </div>
                        <div>
                          <span className="font-semibold">Composition</span>
                          <p>{item.raw_materials.composition || "-"}</p>
                        </div>
                      </div>
                      <div className="flex flex-col gap-y-4">
                        <div>
                          <span className="font-semibold">Weave</span>
                          <p>{item.raw_materials.weave || "-"}</p>
                        </div>
                        <div>
                          <span className="font-semibold">GSM</span>
                          <p>{item.raw_materials.gsm || "-"}</p>
                        </div>
                        <div>
                          <span className="font-semibold">Certifications</span>
                          <p>
                            {item.raw_materials.certifications?.join(", ") ||
                              "-"}
                          </p>
                        </div>
                        <div>
                          <span className="font-semibold">Sustainability</span>
                          <p>
                            {item.raw_materials.sustainability_metrics?.join(
                              ", "
                            ) || "-"}
                          </p>
                        </div>
                        <div>
                          <span className="font-semibold">Price per Unit</span>
                          <p>
                            {item.raw_materials.price_per_unit || "-"} {" "}
                            {item.raw_materials.currency_code}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-4">
          <span className="font-semibold">No raw materials found.</span>
        </div>
      )}
    </div>
  )
}

export default RawMaterialsTab