import { Container, Heading, Text } from "@medusajs/ui"

type ComingSoonProps = {
  title: string
  description?: string
}

/**
 * Shared placeholder for investor routes whose data views aren't built yet.
 * Keeps the sidebar links landing on a real page (no 404 / no-match) while the
 * cap-table, finances, compliance and projections sections are filled in.
 */
export const ComingSoon = ({ title, description }: ComingSoonProps) => {
  return (
    <div className="flex w-full flex-col gap-y-4 px-4 py-6 md:px-6">
      <Container className="p-0">
        <div className="px-6 py-5">
          <Heading level="h1">{title}</Heading>
          <Text className="text-ui-fg-subtle mt-1">
            {description ?? "This section is coming soon."}
          </Text>
        </div>
      </Container>
    </div>
  )
}
