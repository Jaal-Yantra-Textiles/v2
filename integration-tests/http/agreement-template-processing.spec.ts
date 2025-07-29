
import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user";

jest.setTimeout(30000);

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    let headers;
    let personId;
    let agreementId;
    let emailTemplateId;

    beforeEach(async () => {
      const container = getContainer();
      await createAdminUser(container);
      headers = await getAuthHeaders(api);
    });

    describe("Agreement Handlebars Template Processing", () => {
      it("should process Handlebars templates in agreement content when accessed via web API", async () => {
        // Step 1: Create an email template
        const emailTemplatePayload = {
          name: "Agreement Notification",
          template_key: "agreement-notification",
          subject: "Agreement: {{agreement.title}}",
          html_content: `
            <div>
              <h1>Agreement Notification</h1>
              <p>Dear {{response.email_sent_to}},</p>
              <p>You have received an agreement: {{agreement.title}}</p>
              <p>Please review it at your earliest convenience.</p>
            </div>
          `,
          from: "agreements@jaalyantra.com",
          variables: {
            agreement: "Agreement data",
            response: "Response data"
          },
          template_type: 'general'
        };

        const emailTemplateResponse = await api.post(
          "/admin/email-templates",
          emailTemplatePayload,
          headers
        );

        expect(emailTemplateResponse.status).toBe(201);
        emailTemplateId = emailTemplateResponse.data.emailTemplate.id;

        // Step 2: Create an agreement with Handlebars placeholders
        const agreementPayload = {
          title: "Software Development Agreement",
          content: `
            <div class="agreement-container">
              <h1>{{agreement.title}}</h1>
              <p><strong>Agreement ID:</strong> {{agreement.id}}</p>
              <p><strong>Status:</strong> {{agreement.status}}</p>
              
              <div class="recipient-info">
                <h2>Recipient Information</h2>
                <p><strong>Email:</strong> {{response.email_sent_to}}</p>
                <p><strong>Sent Date:</strong> {{formatted_date}}</p>
                <p><strong>Current Status:</strong> {{response.status}}</p>
                
                {{#if response.viewed_at}}
                <p><strong>Viewed At:</strong> {{response.viewed_at}}</p>
                {{/if}}
                
                {{#if response.agreed}}
                <div class="success-message">
                  <p>✅ This agreement has been accepted!</p>
                  {{#if response.response_notes}}
                  <p><strong>Notes:</strong> {{response.response_notes}}</p>
                  {{/if}}
                </div>
                {{else}}
                <div class="pending-message">
                  <p>⏳ This agreement is pending your response.</p>
                </div>
                {{/if}}
              </div>
              
              <div class="agreement-stats">
                <h3>Agreement Statistics</h3>
                <ul>
                  <li>Total Sent: {{agreement.sent_count}}</li>
                  <li>Total Responses: {{agreement.response_count}}</li>
                  <li>Total Agreed: {{agreement.agreed_count}}</li>
                </ul>
              </div>
              
              {{#if agreement.valid_until}}
              <div class="validity-info">
                <p><strong>Valid Until:</strong> {{agreement.valid_until}}</p>
              </div>
              {{/if}}
            </div>
          `,
          subject: "Please review: {{agreement.title}}",
          template_key: "agreement-notification",
          status: "active",
          valid_from: new Date("2025-01-01"),
          valid_until: new Date("2025-12-31"),
          from_email: "agreements@jaalyantra.com"
        };

        const agreementResponse = await api.post(
          "/admin/agreement",
          agreementPayload,
          headers
        );

        expect(agreementResponse.status).toBe(201);
        expect(agreementResponse.data.agreement).toMatchObject({
          title: "Software Development Agreement",
          status: "active",
          template_key: "agreement-notification"
        });
        agreementId = agreementResponse.data.agreement.id;

        // Step 3: Create a person
        const personPayload = {
          first_name: "John",
          last_name: "Doe",
          email: "john.doe@example.com",
          date_of_birth: "1990-01-01"
        };

        const personResponse = await api.post(
          "/admin/persons",
          personPayload,
          headers
        );

        expect(personResponse.status).toBe(201);
        personId = personResponse.data.person.id;

        // Step 4: Send agreement to person
        const sendAgreementPayload = {
          agreement_id: agreementId,
          template_key: "agreement-notification"
        };

        const sendResponse = await api.post(
          `/admin/persons/${personId}/agreements/send`,
          sendAgreementPayload,
          headers
        );

        expect(sendResponse.status).toBe(200);
        expect(sendResponse.data).toMatchObject({
          message: "Agreement sent successfully",
          person_id: personId,
          agreement_id: agreementId
        });

        const agreementResponseId = sendResponse.data.agreement_response.id;
        const accessToken = sendResponse.data.agreement_response.access_token;

        // Step 5: Access the agreement via web API to test Handlebars processing
        const webResponse = await api.get(
          `/web/agreement/${agreementResponseId}?token=${accessToken}`
        );

        expect(webResponse.status).toBe(200);
        expect(webResponse.data.agreement).toBeDefined();
        expect(webResponse.data.response).toBeDefined();

        // Step 6: Verify Handlebars placeholders have been processed
        const processedContent = webResponse.data.agreement.content;
        const processedSubject = webResponse.data.agreement.subject;

        // Check that placeholders have been replaced with actual values
        expect(processedContent).toContain("Software Development Agreement"); // {{agreement.title}}
        expect(processedContent).toContain(agreementId); // {{agreement.id}}
        expect(processedContent).toContain("john.doe@example.com"); // {{response.email_sent_to}}
        expect(processedContent).toContain("viewed"); // {{response.status}} - updated when accessed
        expect(processedContent).toContain("Total Sent: 1"); // {{agreement.sent_count}}
        expect(processedContent).toContain("Total Responses: 0"); // {{agreement.response_count}}
        expect(processedContent).toContain("Total Agreed: 0"); // {{agreement.agreed_count}}
        expect(processedContent).toContain("⏳ This agreement is pending"); // Conditional logic

        // Check that subject has been processed
        expect(processedSubject).toBe("Please review: Software Development Agreement");

        // Verify that Handlebars placeholders are no longer present
        expect(processedContent).not.toContain("{{agreement.title}}");
        expect(processedContent).not.toContain("{{agreement.id}}");
        expect(processedContent).not.toContain("{{response.email_sent_to}}");
        expect(processedContent).not.toContain("{{response.status}}");
        expect(processedSubject).not.toContain("{{agreement.title}}");

        // Step 7: Test conditional logic by updating agreement response status
        // First, let's verify the agreement can be viewed (which updates status to "viewed")
        const viewedResponse = await api.get(
          `/web/agreement/${agreementResponseId}?token=${accessToken}`
        );

        expect(viewedResponse.status).toBe(200);
        expect(viewedResponse.data.response.status).toBe("viewed");

        // The content should now reflect the viewed status
        const viewedContent = viewedResponse.data.agreement.content;
        expect(viewedContent).toContain("viewed"); // {{response.status}} should be "viewed"
        
        console.log("✅ Agreement Handlebars template processing test completed successfully!");
        console.log("- Agreement created with Handlebars placeholders");
        console.log("- Email template created");
        console.log("- Person created and agreement sent");
        console.log("- Web API accessed and templates processed");
        console.log("- All placeholders replaced with actual data");
        console.log("- Conditional logic working correctly");
      });

      it("should handle template processing errors gracefully", async () => {
        // Step 1: Create email template (required for sending agreements)
        const emailTemplatePayload = {
          name: "Agreement Email Template",
          from: "agreements@jaalyantra.com",
          subject: "Agreement: {{agreement.title}}",
          html_content: `
            <p>Dear recipient,</p>
            <p>Please review the agreement: {{agreement.title}}</p>
            <p><a href="{{agreement_url}}">Click here to view</a></p>
          `,
          text_template: "Please review the agreement: {{agreement.title}}",
          status: "active",
          template_key:'agreement-email',
          template_type: 'email'
        };

        const emailTemplateResponse = await api.post(
          "/admin/email-templates",
          emailTemplatePayload,
          headers
        );

        expect(emailTemplateResponse.status).toBe(201);

        // Step 2: Create an agreement with invalid Handlebars syntax
        const agreementPayload = {
          title: "Test Agreement with Invalid Template",
          content: `
            <div>
              <h1>{{agreement.title}}</h1>
              <p>Invalid syntax: {{#if unclosed_block}}</p>
              <p>This should still work: {{agreement.status}}</p>
            </div>
          `,
          subject: "Test: {{agreement.title}}",
          status: "active"
        };

        const agreementResponse = await api.post(
          "/admin/agreement",
          agreementPayload,
          headers
        );

        expect(agreementResponse.status).toBe(201);
        const testAgreementId = agreementResponse.data.agreement.id;

        // Create a person for testing
        const personPayload = {
          first_name: "Test",
          last_name: "User",
          email: "test.user@example.com"
        };

        const personResponse = await api.post(
          "/admin/persons",
          personPayload,
          headers
        );

        expect(personResponse.status).toBe(201);
        const testPersonId = personResponse.data.person.id;

        // Send agreement
        const sendResponse = await api.post(
          `/admin/persons/${testPersonId}/agreements/send`,
          { agreement_id: testAgreementId },
          headers
        );

        expect(sendResponse.status).toBe(200);

        // Access via web API - should not fail even with template errors
        const webResponse = await api.get(
          `/web/agreement/${sendResponse.data.agreement_response.id}?token=${sendResponse.data.agreement_response.access_token}`
        );
        console.log(webResponse.data)
        expect(webResponse.status).toBe(200);
        expect(webResponse.data.agreement.content).toBeDefined();
        
        // Should fallback to original content if template processing fails
        const content = webResponse.data.agreement.content;
        
        // When template processing fails, it should return the original template with placeholders
        expect(content).toContain("{{agreement.title}}"); // Original placeholder should remain
        expect(content).toContain("{{#if unclosed_block}}"); // Invalid syntax should remain
        expect(content).toContain("{{agreement.status}}"); // Other placeholders should remain
        
        // Should NOT contain processed values (since processing failed)
        expect(content).not.toContain("Test Agreement with Invalid Template");
        expect(content).not.toContain("active");
        
        console.log("✅ Template error handling test completed successfully!");
      });
    });
  },
});
