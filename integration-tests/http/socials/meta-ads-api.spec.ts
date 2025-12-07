import { createAdminUser, getAuthHeaders } from "../../helpers/create-admin-user";
import { getSharedTestEnv, setupSharedTestSuite } from "../shared-test-setup";

jest.setTimeout(60000);

setupSharedTestSuite(() => {
  let headers;
  const { api, getContainer } = getSharedTestEnv();

  // Store IDs for cleanup and cross-test references
  let platformId: string;
  let adAccountId: string;
  let campaignId: string;
  let adSetId: string;
  let adId: string;
  let leadFormId: string;

  beforeEach(async () => {
    await createAdminUser(getContainer());
    headers = await getAuthHeaders(api);
  });

  describe("Meta Ads API", () => {
    describe("Complete Meta Ads Flow", () => {
      it("should perform full Meta Ads CRUD flow", async () => {
        // ============================================
        // STEP 1: Create a Facebook platform for testing
        // ============================================
        console.log("\n📱 STEP 1: Creating Facebook platform...");
        
        const platformResponse = await api.post(
          "/admin/social-platforms",
          {
            name: "Facebook Test",
            category: "social",
            auth_type: "oauth2",
            status: "active",
            api_config: {
              provider: "facebook",
              access_token: "test_token",
              user_access_token: "test_user_token",
              user_id: "123456789",
            },
          },
          headers
        );
        expect(platformResponse.status).toBe(201);
        platformId = platformResponse.data.socialPlatform.id;
        console.log(`✅ Platform created: ${platformId}`);

        // ============================================
        // STEP 2: List ad accounts (should be empty)
        // ============================================
        console.log("\n📊 STEP 2: Listing ad accounts (empty)...");
        
        const emptyAccountsResponse = await api.get("/admin/meta-ads/accounts", headers);
        expect(emptyAccountsResponse.status).toBe(200);
        expect(emptyAccountsResponse.data.accounts).toBeInstanceOf(Array);
        console.log(`✅ Found ${emptyAccountsResponse.data.accounts.length} accounts`);

        // ============================================
        // STEP 3: Create an ad account
        // ============================================
        console.log("\n💰 STEP 3: Creating ad account...");
        
        const accountResponse = await api.post(
          "/admin/meta-ads/accounts",
          {
            meta_account_id: "act_123456789",
            name: "Test Ad Account",
            account_status: 1,
            currency: "USD",
            timezone_name: "America/Los_Angeles",
            platform_id: platformId,
          },
          headers
        );
        expect(accountResponse.status).toBe(200);
        expect(accountResponse.data.account).toBeDefined();
        adAccountId = accountResponse.data.account.id;
        console.log(`✅ Ad account created: ${adAccountId}`);

        // ============================================
        // STEP 4: Get ad account by ID
        // ============================================
        console.log("\n🔍 STEP 4: Getting ad account by ID...");
        
        const getAccountResponse = await api.get(
          `/admin/meta-ads/accounts/${adAccountId}`,
          headers
        );
        expect(getAccountResponse.status).toBe(200);
        expect(getAccountResponse.data.account.id).toBe(adAccountId);
        console.log(`✅ Retrieved account: ${getAccountResponse.data.account.name}`);

        // ============================================
        // STEP 5: Create a campaign
        // ============================================
        console.log("\n📢 STEP 5: Creating campaign...");
        
        const campaignResponse = await api.post(
          "/admin/meta-ads/campaigns",
          {
            meta_campaign_id: "120236158582250256",
            name: "Test Campaign",
            objective: "LEAD_GENERATION",
            status: "ACTIVE",
            effective_status: "ACTIVE",
            buying_type: "AUCTION",
            daily_budget: 100,
            ad_account_id: adAccountId,
          },
          headers
        );
        expect(campaignResponse.status).toBe(200);
        expect(campaignResponse.data.campaign).toBeDefined();
        campaignId = campaignResponse.data.campaign.id;
        console.log(`✅ Campaign created: ${campaignId}`);

        // ============================================
        // STEP 6: List campaigns
        // ============================================
        console.log("\n📋 STEP 6: Listing campaigns...");
        
        const listCampaignsResponse = await api.get("/admin/meta-ads/campaigns", headers);
        expect(listCampaignsResponse.status).toBe(200);
        expect(listCampaignsResponse.data.campaigns).toBeInstanceOf(Array);
        expect(listCampaignsResponse.data.campaigns.length).toBeGreaterThan(0);
        console.log(`✅ Found ${listCampaignsResponse.data.campaigns.length} campaigns`);

        // ============================================
        // STEP 7: Create an ad set
        // ============================================
        console.log("\n🎯 STEP 7: Creating ad set...");
        
        const adSetResponse = await api.post(
          "/admin/meta-ads/adsets",
          {
            meta_adset_id: "120237999887920319",
            name: "Test Ad Set",
            status: "ACTIVE",
            effective_status: "ACTIVE",
            daily_budget: 50,
            optimization_goal: "LEAD_GENERATION",
            billing_event: "IMPRESSIONS",
            campaign_id: campaignId,
          },
          headers
        );
        expect(adSetResponse.status).toBe(200);
        expect(adSetResponse.data.adSet).toBeDefined();
        adSetId = adSetResponse.data.adSet.id;
        console.log(`✅ Ad set created: ${adSetId}`);

        // ============================================
        // STEP 8: Create an ad
        // ============================================
        console.log("\n🖼️ STEP 8: Creating ad...");
        
        const adResponse = await api.post(
          "/admin/meta-ads/ads",
          {
            meta_ad_id: "120238000000000001",
            name: "Test Ad",
            status: "ACTIVE",
            effective_status: "ACTIVE",
            creative_id: "1588041649022368",
            preview_url: "https://fb.me/test123",
            ad_set_id: adSetId,
          },
          headers
        );
        expect(adResponse.status).toBe(200);
        expect(adResponse.data.ad).toBeDefined();
        adId = adResponse.data.ad.id;
        console.log(`✅ Ad created: ${adId}`);

        // ============================================
        // STEP 9: Get campaign with nested data
        // ============================================
        console.log("\n📊 STEP 9: Getting campaign with nested data...");
        
        const campaignDetailResponse = await api.get(
          `/admin/meta-ads/campaigns/${campaignId}`,
          headers
        );
        expect(campaignDetailResponse.status).toBe(200);
        expect(campaignDetailResponse.data.campaign.id).toBe(campaignId);
        expect(campaignDetailResponse.data.campaign.ad_sets).toBeInstanceOf(Array);
        expect(campaignDetailResponse.data.campaign.ads).toBeInstanceOf(Array);
        expect(campaignDetailResponse.data.campaign.insights).toBeInstanceOf(Array);
        console.log(`✅ Campaign has ${campaignDetailResponse.data.campaign.ad_sets.length} ad sets`);
        console.log(`✅ Campaign has ${campaignDetailResponse.data.campaign.ads.length} ads`);

        // ============================================
        // STEP 10: Create ad insights
        // ============================================
        console.log("\n📈 STEP 10: Creating ad insights...");
        
        const insightResponse = await api.post(
          "/admin/meta-ads/insights",
          {
            date_start: new Date("2025-12-01"),
            date_stop: new Date("2025-12-01"),
            level: "campaign",
            meta_campaign_id: "120236158582250256",
            impressions: 1000,
            clicks: 50,
            spend: 25.50,
            reach: 800,
            ctr: 5.0,
            cpc: 0.51,
            cpm: 25.50,
            leads: 5,
            cost_per_lead: 5.10,
            campaign_id: campaignId,
          },
          headers
        );
        expect(insightResponse.status).toBe(200);
        expect(insightResponse.data.insight).toBeDefined();
        console.log(`✅ Insight created`);

        // ============================================
        // STEP 11: Create a lead form
        // ============================================
        console.log("\n📝 STEP 11: Creating lead form...");
        
        const leadFormResponse = await api.post(
          "/admin/meta-ads/lead-forms",
          {
            meta_form_id: "1234567890",
            name: "Test Lead Form",
            status: "ACTIVE",
            page_id: "747917475065823",
            questions: [
              { key: "email", label: "Email", type: "EMAIL" },
              { key: "full_name", label: "Full Name", type: "FULL_NAME" },
            ],
            platform_id: platformId,
            ad_account_id: adAccountId, // Required field
          },
          headers
        );
        expect(leadFormResponse.status).toBe(200);
        expect(leadFormResponse.data.leadForm).toBeDefined();
        leadFormId = leadFormResponse.data.leadForm.id;
        console.log(`✅ Lead form created: ${leadFormId}`);

        // ============================================
        // STEP 12: Create a lead
        // ============================================
        console.log("\n👤 STEP 12: Creating lead...");
        
        const leadResponse = await api.post(
          "/admin/meta-ads/leads",
          {
            meta_lead_id: "lead_123456789",
            form_id: leadFormId,
            ad_id: adId,
            campaign_id: campaignId,
            field_data: {
              email: "test@example.com",
              full_name: "John Doe",
            },
            created_time: new Date().toISOString(),
            platform_id: platformId, // Use platform_id instead of platform
            is_organic: false,
          },
          headers
        );
        expect(leadResponse.status).toBe(200);
        expect(leadResponse.data.lead).toBeDefined();
        console.log(`✅ Lead created: ${leadResponse.data.lead.id}`);

        // ============================================
        // STEP 13: List leads
        // ============================================
        console.log("\n📋 STEP 13: Listing leads...");
        
        const listLeadsResponse = await api.get("/admin/meta-ads/leads", headers);
        expect(listLeadsResponse.status).toBe(200);
        expect(listLeadsResponse.data.leads).toBeInstanceOf(Array);
        expect(listLeadsResponse.data.leads.length).toBeGreaterThan(0);
        console.log(`✅ Found ${listLeadsResponse.data.leads.length} leads`);

        console.log("\n✅ === META ADS FLOW TEST COMPLETE ===\n");
      });
    });

    describe("Error Handling", () => {
      it("should return 404 for non-existent campaign", async () => {
        const response = await api.get(
          "/admin/meta-ads/campaigns/non_existent_id",
          headers
        ).catch((err) => err.response);

        expect(response.status).toBe(404);
      });

      it("should return 400 for missing ad_account_id in sync", async () => {
        const response = await api.post(
          "/admin/meta-ads/campaigns/sync",
          {}, // Missing ad_account_id
          headers
        ).catch((err) => err.response);

        expect(response.status).toBe(400);
        expect(response.data.message).toContain("ad_account_id");
      });
    });
  });
});
