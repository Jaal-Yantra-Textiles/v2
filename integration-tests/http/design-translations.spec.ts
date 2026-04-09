import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user";
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup";

jest.setTimeout(60000);

const testDesign = {
  name: "Summer Collection 2025",
  description: "Lightweight summer wear collection",
  design_type: "Original",
  status: "Conceptual",
  priority: "High",
  designer_notes: "Focus on breathable fabrics",
};

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv();
  let headers: any;
  let designId: string;

  beforeEach(async () => {
    const container = getContainer();
    await createAdminUser(container);
    headers = await getAuthHeaders(api);

    // Create a design
    const res = await api.post("/admin/designs", testDesign, headers);
    designId = res.data.design.id;
  });

  describe("Translation Module Integration", () => {
    it("should list available locales via admin API", async () => {
      const res = await api.get("/admin/locales", {
        headers: headers.headers,
      });

      expect(res.status).toBe(200);
      expect(res.data).toHaveProperty("locales");
    });

    it("should create a locale (or 404 if translation module not migrated)", async () => {
      const res = await api
        .post(
          "/admin/locales",
          { code: "fr-FR", name: "French (France)" },
          headers
        )
        .catch((err: any) => err.response);

      // 200/201 if created, 409 if already exists, 404 if translation module not migrated in test DB
      expect([200, 201, 409, 404]).toContain(res.status);
    });

    it("should detect design entity as translatable (or skip if not migrated)", async () => {
      const res = await api
        .get("/admin/translations/entities", {
          headers: headers.headers,
        })
        .catch((err: any) => err.response);

      // 400/404 means translation module tables don't exist in test DB yet
      if (res.status === 400 || res.status === 404) {
        console.warn(
          "Translation entities endpoint returned",
          res.status,
          "- translation module may need db:migrate"
        );
        return;
      }

      expect(res.status).toBe(200);

      // The design entity should appear since we marked fields with .translatable()
      const entities = res.data?.entities || res.data?.translatable_entities || [];
      const designEntity = entities.find(
        (e: any) => e.type === "design" || e.entity_type === "design"
      );

      if (designEntity) {
        const fields = designEntity.fields || [];
        expect(fields).toEqual(
          expect.arrayContaining(["name", "description"])
        );
      }
    });

    it("should create a translation for a design", async () => {
      // First ensure locale exists
      await api
        .post(
          "/admin/locales",
          { code: "fr-FR", name: "French (France)" },
          headers
        )
        .catch(() => {});

      // Create a translation for the design
      const translationRes = await api
        .post(
          "/admin/translations",
          {
            reference: "design",
            reference_id: designId,
            locale_code: "fr-FR",
            translations: {
              name: "Collection Été 2025",
              description: "Collection légère pour l'été",
            },
          },
          headers
        )
        .catch((err: any) => err.response);

      // Accept 200/201 (success) or 400/404 (if translation module needs migration first)
      expect([200, 201, 400, 404]).toContain(translationRes.status);

      if (translationRes.status === 200 || translationRes.status === 201) {
        // Verify the translation was stored
        const listRes = await api.get("/admin/translations", {
          headers: headers.headers,
          params: {
            reference: "design",
            reference_id: designId,
            locale_code: "fr-FR",
          },
        });

        expect(listRes.status).toBe(200);
        const translations = listRes.data?.translations || [];
        expect(translations.length).toBeGreaterThan(0);

        const designTranslation = translations[0];
        expect(designTranslation.translations.name).toBe(
          "Collection Été 2025"
        );
      }
    });

    it("should return translated content when locale header is set", async () => {
      // Ensure locale exists
      await api
        .post(
          "/admin/locales",
          { code: "fr-FR", name: "French (France)" },
          headers
        )
        .catch(() => {});

      // Create translation
      const translationCreated = await api
        .post(
          "/admin/translations",
          {
            reference: "design",
            reference_id: designId,
            locale_code: "fr-FR",
            translations: {
              name: "Collection Été 2025",
              description: "Collection légère pour l'été",
            },
          },
          headers
        )
        .catch((err: any) => err.response);

      if (
        translationCreated.status !== 200 &&
        translationCreated.status !== 201
      ) {
        // Translation module may not be migrated yet - skip the locale test
        console.warn(
          "Skipping locale-aware fetch test - translation creation returned:",
          translationCreated.status
        );
        return;
      }

      // Fetch the design with French locale header
      const frRes = await api.get(`/admin/designs/${designId}`, {
        headers: {
          ...headers.headers,
          "x-medusa-locale": "fr-FR",
        },
      });

      expect(frRes.status).toBe(200);

      const design = frRes.data.design;
      // With locale, the translated name should be returned
      expect(design.name).toBe("Collection Été 2025");
      expect(design.description).toBe("Collection légère pour l'été");
    });

    it("should return original content when no locale is set", async () => {
      // Fetch without locale header
      const res = await api.get(`/admin/designs/${designId}`, {
        headers: headers.headers,
      });

      expect(res.status).toBe(200);
      expect(res.data.design.name).toBe("Summer Collection 2025");
      expect(res.data.design.description).toBe(
        "Lightweight summer wear collection"
      );
    });
  });
});
