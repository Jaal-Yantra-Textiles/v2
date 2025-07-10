import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

jest.setTimeout(50000)

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    it("should trigger the geocodeAddressWorkflow and log the address", async () => {
      const container = getContainer()
      await createAdminUser(container)
      const headers = await getAuthHeaders(api)

      // Create a person
      const personResponse = await api.post(
        "/admin/persons",
        {
          first_name: "Debug",
          last_name: "User",
          email: "debug.user@example.com",
        },
        headers
      )
      const person = personResponse.data.person

      // Create an address via the API to trigger the subscriber and workflow
      await api.post(
        `/admin/persons/${person.id}/addresses`,
        {
          street: "200 W Washington St",
          city: "Phoenix",
          state: "AZ",
          postal_code: "85003",
          country: "US",
        },
        headers
      )

      // Wait for a moment to allow the async workflow to log the output
      await new Promise((resolve) => setTimeout(resolve, 3000))
    })
  },
})
