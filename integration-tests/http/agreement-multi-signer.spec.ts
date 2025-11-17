import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user";
import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup";

jest.setTimeout(30000);

setupSharedTestSuite(() => {
  let headers;

  beforeAll(async () => {
    const { api, getContainer } = getSharedTestEnv();
    await createAdminUser(getContainer());
    headers = await getAuthHeaders(api);
  });
  
  describe("Multi-Signer Agreement Email Workflow", () => {
    it("should send agreement to multiple signers and create responses for all", async () => {
      const { api } = getSharedTestEnv();
      console.log('Starting multi-signer test');
      console.log('headers:', JSON.stringify(headers, null, 2));
      
      // Create test persons for this test
      const person1Response = await api.post(
        "/admin/persons",
        {
          first_name: "John",
          last_name: "Doe",
          email: "john.doe@example.com",
        },
        headers
      );
      const personId1 = person1Response.data.person.id;

      const person2Response = await api.post(
        "/admin/persons",
        {
          first_name: "Jane",
          last_name: "Smith",
          email: "jane.smith@example.com",
        },
        headers
      );
      const personId2 = person2Response.data.person.id;

      const person3Response = await api.post(
        "/admin/persons",
        {
          first_name: "Bob",
          last_name: "Johnson",
          email: "bob.johnson@example.com",
        },
        headers
      );
      const personId3 = person3Response.data.person.id;
      
      // Create test agreement for this test
      const agreementResponse = await api.post(
        "/admin/agreements",
        {
          title: "Multi-Signer Agreement",
          content: `
            <div>
              <h1>{{agreement.title}}</h1>
              <p>This is a multi-signer agreement for {{response.email_sent_to}}</p>
              <p>Agreement ID: {{agreement.id}}</p>
            </div>
          `,
          subject: "Please review: {{agreement.title}}",
          template_key: "multi-signer-agreement",
          status: "active",
          from_email: "agreements@jaalyantra.com"
        },
        headers
      );
      const agreementId = agreementResponse.data.agreement.id;
      
      // Create email template for this test
      const emailTemplateResponse = await api.post(
        "/admin/email-templates",
        {
          name: "Multi-Signer Agreement Notification",
          template_key: "multi-signer-agreement",
          subject: "Agreement: {{agreement.title}}",
          html_content: `
            <div>
              <h1>Multi-Signer Agreement</h1>
              <p>Dear {{person.first_name}} {{person.last_name}},</p>
              <p>Please review the agreement: {{agreement.title}}</p>
              <p><a href="{{agreement_url}}">View Agreement</a></p>
            </div>
          `,
          from: "agreements@jaalyantra.com",
          variables: {
            agreement: "Agreement data",
            response: "Response data"
          },
          template_type: 'general'
        },
        headers
      );
      const emailTemplateId = emailTemplateResponse.data.emailTemplate.id;
      
      // Send agreement to multiple signers
      try {
        const sendResponse = await api.post(
          `/admin/persons/${personId1}/agreements/send`,
          {
            agreement_id: agreementId,
            person_ids: [personId2, personId3], // Additional signers
            template_key: "multi-signer-agreement"
          },
          headers
        );
        
        console.log('Response received:', JSON.stringify(sendResponse.data, null, 2));
        
        expect(sendResponse.status).toBe(200);
        expect(sendResponse.data).toMatchObject({
          message: "Agreement sent successfully to all signers",
          agreement_id: agreementId
        });
        
        // Verify all person IDs are included
        expect(sendResponse.data.person_ids).toEqual([personId1, personId2, personId3]);
        
        // Verify agreement responses were created for all signers
        expect(sendResponse.data.agreement_responses).toHaveLength(3);
        
        // Verify person-agreement links were created for all signers
        expect(sendResponse.data.person_agreement_links).toHaveLength(3);
        
        // Verify email results for all signers
        expect(sendResponse.data.email_results).toHaveLength(3);
        
        // Verify each agreement response has the required fields
        for (const response of sendResponse.data.agreement_responses) {
          expect(response).toHaveProperty("id");
          expect(response).toHaveProperty("agreement_id", agreementId);
          expect(response).toHaveProperty("status", "sent");
          expect(response).toHaveProperty("access_token");
          expect(response.access_token).toHaveLength(64); // 32 bytes hex encoded
        }
        
        // Verify each email result has the required fields
        for (const emailResult of sendResponse.data.email_results) {
          expect(emailResult).toHaveProperty("person_id");
          expect(emailResult).toHaveProperty("email_result");
        }
        
        // Verify stats were updated (returns an array with the updated agreement object)
        expect(sendResponse.data.stats_updated).toBeDefined();
        expect(Array.isArray(sendResponse.data.stats_updated)).toBe(true);
        expect(sendResponse.data.stats_updated[0]).toHaveProperty('id');
        expect(sendResponse.data.stats_updated[0]).toHaveProperty('sent_count');
      } catch (error) {
        console.error('Error in multi-signer test:', error.response?.data || error.message);
        throw error;
      }
    });

    it("should maintain backward compatibility for single signer", async () => {
      const { api } = getSharedTestEnv();
      console.log('Starting backward compatibility test');
      console.log('headers:', JSON.stringify(headers, null, 2));
      
      // Create test persons for this test
      const person1Response = await api.post(
        "/admin/persons",
        {
          first_name: "Alice",
          last_name: "Brown",
          email: "alice.brown@example.com",
        },
        headers
      );
      const personId1 = person1Response.data.person.id;
      
      // Create test agreement for this test
      const agreementResponse = await api.post(
        "/admin/agreements",
        {
          title: "Single Signer Agreement",
          content: `
            <div>
              <h1>{{agreement.title}}</h1>
              <p>This is a single signer agreement for {{response.email_sent_to}}</p>
              <p>Agreement ID: {{agreement.id}}</p>
            </div>
          `,
          subject: "Please review: {{agreement.title}}",
          template_key: "multi-signer-agreement",
          status: "active",
          from_email: "agreements@jaalyantra.com"
        },
        headers
      );
      const agreementId = agreementResponse.data.agreement.id;
      
      // Create email template for this test
      const emailTemplateResponse = await api.post(
        "/admin/email-templates",
        {
          name: "Single Signer Agreement Notification",
          template_key: "multi-signer-agreement",
          subject: "Agreement: {{agreement.title}}",
          html_content: `
            <div>
              <h1>Single Signer Agreement</h1>
              <p>Dear {{person.first_name}} {{person.last_name}},</p>
              <p>Please review the agreement: {{agreement.title}}</p>
              <p><a href="{{agreement_url}}">View Agreement</a></p>
            </div>
          `,
          from: "agreements@jaalyantra.com",
          variables: {
            agreement: "Agreement data",
            response: "Response data"
          },
          template_type: 'general'
        },
        headers
      );
      const emailTemplateId = emailTemplateResponse.data.emailTemplate.id;
      
      // Send agreement to single signer (backward compatibility)
      try {
        const sendResponse = await api.post(
          `/admin/persons/${personId1}/agreements/send`,
          {
            agreement_id: agreementId,
            template_key: "multi-signer-agreement"
          },
          headers
        );
        
        console.log('Response received:', JSON.stringify(sendResponse.data, null, 2));
        
        expect(sendResponse.status).toBe(200);
        expect(sendResponse.data).toMatchObject({
          message: "Agreement sent successfully",
          person_id: personId1,
          agreement_id: agreementId
        });
        
        // Verify single signer response structure
        expect(sendResponse.data).toHaveProperty("agreement_response");
        expect(sendResponse.data).toHaveProperty("person_agreement_link");
        expect(sendResponse.data).toHaveProperty("email_result");
        expect(sendResponse.data).toHaveProperty("stats_updated");
        // Verify stats were updated (returns an array with the updated agreement object)
        expect(sendResponse.data.stats_updated).toBeDefined();
        expect(Array.isArray(sendResponse.data.stats_updated)).toBe(true);
        expect(sendResponse.data.stats_updated[0]).toHaveProperty('id');
        expect(sendResponse.data.stats_updated[0]).toHaveProperty('sent_count');
      } catch (error) {
        console.error('Error in backward compatibility test:', error.response?.data || error.message);
        throw error;
      }
    });
  });
});