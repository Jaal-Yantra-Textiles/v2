// NOTE: the design↔customer link is `isList: true` (a design can be linked to
// multiple customers via orders), so query.graph's accessor is the PLURAL
// `customers` — `customer.*` makes query.graph forward an unknown relation to
// MikroORM populate and 500 ("Entity 'Design' does not have property 'customer'").
// Newer Medusa (2.15.x) rejects this where it was previously tolerated.
export const DESIGN_DETAIL_FIELDS =
  "inventory_items.*, tasks.*, tasks.outgoing.*, tasks.incoming.*, partners.*, colors.*, size_sets.*, customers.*";