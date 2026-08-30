// #1662 — a line bought as finished fabric/goods has NO raw material, so
// `material_name` is null and the fallback was the inventory item's title —
// which for a variant-made item is the VARIANT's title alone ("M", "Red").
// The product and variant are pulled through so the line can name what was
// actually bought instead of a bare size or colour.
export const INVENTORY_ORDER_DETAIL_FIELDS = "orderlines.*, orderlines.inventory_items.*, orderlines.inventory_items.variants.id, orderlines.inventory_items.variants.title, orderlines.inventory_items.variants.sku, orderlines.inventory_items.variants.product.id, orderlines.inventory_items.variants.product.title, orderlines.inventory_items.variants.product.thumbnail, stock_locations.*, stock_locations.address.*, +tasks.*, +partner.*";