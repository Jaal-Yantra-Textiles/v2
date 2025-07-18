import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { geocodeAllAddressesWorkflowId } from "../../src/workflows/persons/geocode-all-addresses"
import PersonService from "../../src/modules/person/service"
import { PERSON_MODULE } from "../../src/modules/person"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"


jest.setTimeout(50000) // Longer timeout for workflow processing

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    let headers
    let person: any
    let address: any

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      headers = await getAuthHeaders(api)

      // Create a person
      const personResponse = await api.post(
        "/admin/persons",
        {
          first_name: "John",
          last_name: "Doe",
          email: "john.doe@example.com",
        },
        headers
      )
      person = personResponse.data.person

      // Create a pre-geocoded address to prevent the initial workflow from running
      await api.post(
        `/admin/persons/${person.id}/addresses`,
        {
          street: "1 Infinite Loop",
          city: "Cupertino",
          state: "CA",
          postal_code: "95014",
          country: "US",
          latitude: 37.3318,
          longitude: -122.0312,
        },
        headers
      )

      // Use the PersonService to create the address directly, bypassing the event system
      const personService = container.resolve<PersonService>(PERSON_MODULE)
      const createdAddresses = await personService.createAddresses([
        {
          person_id: person.id,
          street: "1600 Amphitheatre Parkway",
          city: "Mountain View",
          state: "CA",
          postal_code: "94043",
          country: "US",
        },
      ])
      address = createdAddresses[0]
    })

    it("should trigger the geocode all addresses workflow, wait for confirmation, and geocode the address", async () => {
      // Trigger the workflow
      const triggerResponse = await api.post(
        "/admin/persons/geocode-addresses",
        { person_id: person.id },
        headers
      )
      console.log(triggerResponse.data)
      expect(triggerResponse.status).toBe(202)
      expect(triggerResponse.data.transaction_id).toBeDefined()
      expect(triggerResponse.data.summary.count).toBe(1)

      const transactionId = triggerResponse.data.transaction_id
      console.log(transactionId)
      // Confirm the workflow is waiting
      const executionResponse = await api.get(
        `/admin/workflows-executions/backfill-all-geocodes/${transactionId}`,
        headers
      )
      console.log(executionResponse.data)
      expect(executionResponse.data.workflow_execution.state).toBe("invoking")

      // Send the confirmation
      const confirmResponse = await api.post(
        `/admin/persons/geocode-addresses/${transactionId}/confirm`,
        {workflow_id: 'backfill-all-geocodes', step_id: "wait-confirmation-backfill-geocodes"},
        headers
      )
      expect(confirmResponse.status).toBe(200)

      // Wait for the workflow to complete
      await new Promise((resolve) => setTimeout(resolve, 5000))

      // Verify the address was geocoded
      const updatedPersonResponse = await api.get(
        `/admin/persons/${person.id}/addresses`,
        headers
      )
      console.log(updatedPersonResponse.data)
      const updatedAddress = updatedPersonResponse.data.addresses.find(
        (a) => a.id === address.id
      )

      expect(updatedAddress.latitude).not.toBeNull()
      expect(updatedAddress.longitude).not.toBeNull()
    })
  },
})
