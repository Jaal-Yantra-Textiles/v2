import { Container, Heading, Text } from "@medusajs/ui"

const ProductionRunsIndex = () => {
  return (
    <Container className="flex flex-col gap-y-2 p-6">
      <Heading level="h1">Production Runs</Heading>
      <Text className="text-ui-fg-subtle">
        Production runs are created from the Designs section. Open a design and
        use "New Run" to schedule production, or jump to an individual run from
        its design page.
      </Text>
    </Container>
  )
}

export const handle = {
  breadcrumb: () => "Runs",
}

export default ProductionRunsIndex
