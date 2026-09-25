import { Button, Container, Heading, Text } from "@medusajs/ui"

import { Link } from "react-router-dom"

/**
 * Who hears about this design (#2111).
 *
 * 🔴 It renders when there is NOBODY, not only when there is somebody. That is
 * the whole point: every customer email about a design — production started,
 * production complete, materials delivered, status changed — resolves its
 * recipient through the design↔customer link and returns SILENTLY when there
 * is none. Not an error, not a warning. Five Oshen designs sat unreachable for
 * a month while their client browsed the products on the storefront.
 *
 * So the empty state is the loud one, and it says what the absence COSTS
 * rather than reading "—" like an optional field nobody filled in.
 */
type DesignCustomer = {
  id?: string | null
  email?: string | null
  first_name?: string | null
  last_name?: string | null
}

const displayName = (c: DesignCustomer) =>
  [c.first_name, c.last_name].filter(Boolean).join(" ") ||
  c.email ||
  "Unnamed customer"

export const DesignCustomerSection = ({ design }: { design: any }) => {
  /*
   * Reads the design the page already loaded — `customers.*` is in
   * DESIGN_DETAIL_FIELDS. A link row with nothing on the other end is not a
   * customer: counting it would render a name-less panel over a design that
   * still reaches nobody.
   */
  const customer: DesignCustomer | null = Array.isArray(design?.customers)
    ? design.customers.filter((c: DesignCustomer) => c && c.id && c.email)[0] ??
      null
    : null

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Customer</Heading>
        <Link to="customer">
          <Button size="small" variant="secondary">
            {customer ? "Change" : "Attach"}
          </Button>
        </Link>
      </div>

      <div className="px-6 py-4">
        {customer ? (
          <>
            <Text size="small" leading="compact" weight="plus">
              {displayName(customer)}
            </Text>
            <Text size="small" leading="compact" className="text-ui-fg-subtle">
              {customer.email} — updates about this design go here
            </Text>
          </>
        ) : (
          <Text size="small" leading="compact" className="text-ui-fg-subtle">
            Nobody is attached, so every update about this design reaches no one
            — and nothing reports that it didn&apos;t.
          </Text>
        )}
      </div>
    </Container>
  )
}
