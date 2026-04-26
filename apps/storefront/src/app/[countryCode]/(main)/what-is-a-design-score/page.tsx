import { Heading, Text } from "@medusajs/ui"
import { Metadata } from "next"

export const metadata: Metadata = {
  title: "What is a Design Score?",
  description: "Learn how we score the completeness of our product designs.",
}

const WhatIsADesignScorePage = () => {
  return (
    <div className="content-container py-8">
      <Heading level="h1" className="mb-4">
        What is a Design Score?
      </Heading>
      <div className="flex flex-col gap-y-4">
        <Text>
          The Design Score is a rating we assign to each product design to indicate
          how complete and detailed its information is. A higher score means more
          transparency and a better understanding of the product's lifecycle.
        </Text>
        <Heading level="h2" className="mt-4">
          How is the score calculated?
        </Heading>
        <Text>
          The score is calculated on a scale of 0 to 4, with points awarded for
          the following criteria:
        </Text>
        <ul className="list-disc list-inside flex flex-col gap-y-2">
          <li>
            <span className="font-semibold">1 Point:</span> Basic design
            information is available.
          </li>
          <li>
            <span className="font-semibold">1 Point:</span> Detailed production
            tasks are documented.
          </li>
          <li>
            <span className="font-semibold">1 Point:</span> All involved partners
            (e.g., manufacturers, suppliers) are listed.
          </li>
          <li>
            <span className="font-semibold">1 Point:</span> Raw material details,
            including composition and sourcing, are provided.
          </li>
        </ul>
        <Text className="mt-4">
          A score of 4/4 signifies that the design has complete traceability from
          concept to finished product.
        </Text>
      </div>
    </div>
  )
}

export default WhatIsADesignScorePage
