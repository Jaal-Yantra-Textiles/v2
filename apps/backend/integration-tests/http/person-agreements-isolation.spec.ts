import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user";
import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup";

jest.setTimeout(60000);

setupSharedTestSuite(() => {
  let headers;

  beforeAll(async () => {
    const { api, getContainer } = getSharedTestEnv();
    await createAdminUser(getContainer());
    headers = await getAuthHeaders(api);
  });

  describe("Person Agreements Isolation", () => {
    let aliceId: string;
    let bobId: string;
    let agreement1Id: string;
    let agreement2Id: string;
    let aliceResp1Id: string;
    let aliceResp2Id: string;
    let bobResp1Id: string;

    beforeAll(async () => {
      const { api } = getSharedTestEnv();

      // Create email template required for sending agreements
      await api.post(
        "/admin/email-templates",
        {
          name: "Isolation Test Template",
          template_key: "isolation-test-template",
          subject: "Agreement: {{agreement.title}}",
          html_content: `<p>Dear {{person.first_name}},</p><p>Please review: {{agreement.title}}</p>`,
          from: "test@jaalyantra.com",
          variables: { agreement: "Agreement data", person: "Person data" },
          template_type: "email",
        },
        headers
      );

      // Create two persons: Alice and Bob
      const aliceRes = await api.post(
        "/admin/persons",
        { first_name: "Alice", last_name: "Isolation", email: "alice.isolation@example.com" },
        headers
      );
      aliceId = aliceRes.data.person.id;

      const bobRes = await api.post(
        "/admin/persons",
        { first_name: "Bob", last_name: "Isolation", email: "bob.isolation@example.com" },
        headers
      );
      bobId = bobRes.data.person.id;

      // Create two agreements
      const agr1Res = await api.post(
        "/admin/agreements",
        {
          title: "Shared Agreement",
          content: "<p>This agreement is sent to both Alice and Bob</p>",
          subject: "Please review: {{agreement.title}}",
          template_key: "isolation-test-template",
          status: "active",
          from_email: "test@jaalyantra.com",
        },
        headers
      );
      agreement1Id = agr1Res.data.agreement.id;

      const agr2Res = await api.post(
        "/admin/agreements",
        {
          title: "Alice-Only Agreement",
          content: "<p>This agreement is only for Alice</p>",
          subject: "Please review: {{agreement.title}}",
          template_key: "isolation-test-template",
          status: "active",
          from_email: "test@jaalyantra.com",
        },
        headers
      );
      agreement2Id = agr2Res.data.agreement.id;

      // Send agreement 1 to Alice
      const sendAlice1 = await api.post(
        `/admin/persons/${aliceId}/agreements/send`,
        { agreement_id: agreement1Id, template_key: "isolation-test-template" },
        headers
      );
      expect(sendAlice1.status).toBe(200);
      aliceResp1Id = sendAlice1.data.agreement_response.id;

      // Send agreement 1 to Bob
      const sendBob1 = await api.post(
        `/admin/persons/${bobId}/agreements/send`,
        { agreement_id: agreement1Id, template_key: "isolation-test-template" },
        headers
      );
      expect(sendBob1.status).toBe(200);
      bobResp1Id = sendBob1.data.agreement_response.id;

      // Send agreement 2 to Alice only
      const sendAlice2 = await api.post(
        `/admin/persons/${aliceId}/agreements/send`,
        { agreement_id: agreement2Id, template_key: "isolation-test-template" },
        headers
      );
      expect(sendAlice2.status).toBe(200);
      aliceResp2Id = sendAlice2.data.agreement_response.id;
    });

    it("should return only Alice's agreements when fetching Alice's agreements", async () => {
      const { api } = getSharedTestEnv();

      console.log("aliceId:", aliceId, "bobId:", bobId);
      console.log("agreement1Id:", agreement1Id, "agreement2Id:", agreement2Id);

      let res;
      try {
        res = await api.get(`/admin/persons/${aliceId}/agreements`, headers);
      } catch (error: any) {
        console.error("GET agreements failed:", JSON.stringify(error.response?.data, null, 2));
        throw error;
      }

      expect(res.status).toBe(200);
      expect(res.data.person_id).toBe(aliceId);
      expect(res.data.person_name).toContain("Alice");
      expect(res.data.count).toBe(2);

      const agrIds = res.data.agreements.map((a: any) => a.id);
      expect(agrIds).toContain(agreement1Id);
      expect(agrIds).toContain(agreement2Id);
    });

    it("should return only Bob's agreements when fetching Bob's agreements", async () => {
      const { api } = getSharedTestEnv();

      const res = await api.get(`/admin/persons/${bobId}/agreements`, headers);

      expect(res.status).toBe(200);
      expect(res.data.person_id).toBe(bobId);
      expect(res.data.person_name).toContain("Bob");
      // Bob should only have agreement 1, NOT agreement 2
      expect(res.data.count).toBe(1);

      const agrIds = res.data.agreements.map((a: any) => a.id);
      expect(agrIds).toContain(agreement1Id);
      expect(agrIds).not.toContain(agreement2Id);
    });

    it("should not leak Alice's responses into Bob's agreement view", async () => {
      const { api } = getSharedTestEnv();

      const res = await api.get(`/admin/persons/${bobId}/agreements`, headers);

      expect(res.status).toBe(200);
      const sharedAgreement = res.data.agreements.find((a: any) => a.id === agreement1Id);
      expect(sharedAgreement).toBeDefined();

      // Bob should only see his own response for the shared agreement, not Alice's
      expect(sharedAgreement.responses).toHaveLength(1);
      expect(sharedAgreement.responses[0].id).toBe(bobResp1Id);
      // Must NOT contain Alice's response
      const responseIds = sharedAgreement.responses.map((r: any) => r.id);
      expect(responseIds).not.toContain(aliceResp1Id);
    });

    it("should not leak Bob's responses into Alice's agreement view", async () => {
      const { api } = getSharedTestEnv();

      const res = await api.get(`/admin/persons/${aliceId}/agreements`, headers);

      expect(res.status).toBe(200);
      const sharedAgreement = res.data.agreements.find((a: any) => a.id === agreement1Id);
      expect(sharedAgreement).toBeDefined();

      // Alice should only see her own response for the shared agreement, not Bob's
      expect(sharedAgreement.responses).toHaveLength(1);
      expect(sharedAgreement.responses[0].id).toBe(aliceResp1Id);
      const responseIds = sharedAgreement.responses.map((r: any) => r.id);
      expect(responseIds).not.toContain(bobResp1Id);
    });

    it("should return correct data for a specific agreement via [agreementId] route", async () => {
      const { api } = getSharedTestEnv();

      // Alice fetches the shared agreement
      const aliceRes = await api.get(
        `/admin/persons/${aliceId}/agreements/${agreement1Id}`,
        headers
      );

      expect(aliceRes.status).toBe(200);
      expect(aliceRes.data.person_id).toBe(aliceId);
      expect(aliceRes.data.agreement.id).toBe(agreement1Id);
      // Only Alice's response
      expect(aliceRes.data.agreement.responses).toHaveLength(1);
      expect(aliceRes.data.agreement.responses[0].id).toBe(aliceResp1Id);

      // Bob fetches the same shared agreement
      const bobRes = await api.get(
        `/admin/persons/${bobId}/agreements/${agreement1Id}`,
        headers
      );

      expect(bobRes.status).toBe(200);
      expect(bobRes.data.person_id).toBe(bobId);
      expect(bobRes.data.agreement.id).toBe(agreement1Id);
      // Only Bob's response
      expect(bobRes.data.agreement.responses).toHaveLength(1);
      expect(bobRes.data.agreement.responses[0].id).toBe(bobResp1Id);
    });

    it("should return 404 when Bob tries to access Alice-only agreement", async () => {
      const { api } = getSharedTestEnv();

      try {
        await api.get(
          `/admin/persons/${bobId}/agreements/${agreement2Id}`,
          headers
        );
        fail("Expected 404 error");
      } catch (error: any) {
        expect(error.response.status).toBe(404);
      }
    });

    it("should return correct responses via the responses sub-route", async () => {
      const { api } = getSharedTestEnv();

      // Alice's responses for the shared agreement
      const aliceRes = await api.get(
        `/admin/persons/${aliceId}/agreements/${agreement1Id}/responses`,
        headers
      );

      expect(aliceRes.status).toBe(200);
      expect(aliceRes.data.agreement_id).toBe(agreement1Id);
      expect(aliceRes.data.person_id).toBe(aliceId);
      expect(aliceRes.data.agreement_responses).toHaveLength(1);
      expect(aliceRes.data.agreement_responses[0].id).toBe(aliceResp1Id);

      // Bob's responses for the shared agreement
      const bobRes = await api.get(
        `/admin/persons/${bobId}/agreements/${agreement1Id}/responses`,
        headers
      );

      expect(bobRes.status).toBe(200);
      expect(bobRes.data.agreement_id).toBe(agreement1Id);
      expect(bobRes.data.person_id).toBe(bobId);
      expect(bobRes.data.agreement_responses).toHaveLength(1);
      expect(bobRes.data.agreement_responses[0].id).toBe(bobResp1Id);
    });
  });
});
