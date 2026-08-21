import { Container } from "@medusajs/ui"

import { MintQuoteForm } from "./mint-quote-form"

const MintQuotePage = () => (
  <Container className="p-0">
    <MintQuoteForm />
  </Container>
)

export const handle = {
  breadcrumb: () => "Mint",
}

export default MintQuotePage
