import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user";
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup";

/**
 * #938 — a design carries a garment TYPE, inferred when not supplied.
 *
 * The type is what makes a production spec derivable, and therefore what a
 * design costs, so the rules that matter here are about PRECEDENCE and
 * NORMALISATION rather than about the model's answer:
 *
 *  - a human's type is never overwritten by inference
 *  - two spellings of the same garment are one type
 *  - inference failing must not fail the design
 *
 * The model call short-circuits under NODE_ENV=test (see
 * `infer-design-product-type.ts`), same as `create-design-from-llm` and
 * `gen-ai-desc`. The stand-in keyword-matches the design's own text, so these
 * assert a real mapping rather than a constant.
 */
setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv();
  let headers;

  beforeEach(async () => {
    const container = getContainer();
    await createAdminUser(container);
    headers = await getAuthHeaders(api);
  });

  const baseDesign = {
    description: "A lightweight piece",
    design_type: "Original",
    status: "Conceptual",
    priority: "Medium",
  };

  describe("POST /admin/designs — type on create", () => {
    it("infers the garment type when the caller does not supply one", async () => {
      const res = await api.post(
        "/admin/designs",
        { ...baseDesign, name: "Summer Trousers, wide leg" },
        headers
      );

      expect(res.status).toBe(201);
      // The CREATE response must already carry it — the workflow re-reads the
      // design after inference precisely so this is not a lie.
      expect(res.data.design.product_type).toBe("trousers");
      expect(res.data.design.product_type_source).toBe("inferred");
    });

    it("treats a supplied type as the human's word and normalises it", async () => {
      const res = await api.post(
        "/admin/designs",
        { ...baseDesign, name: "Festive set", product_type: "  Kurta Set " },
        headers
      );

      expect(res.status).toBe(201);
      expect(res.data.design.product_type).toBe("kurta_set");
      expect(res.data.design.product_type_source).toBe("manual");
    });

    it("stores no type rather than a bent one when the value is unusable", async () => {
      const res = await api.post(
        "/admin/designs",
        { ...baseDesign, name: "Handwoven pashmina in indigo", product_type: "!!!" },
        headers
      );

      expect(res.status).toBe(201);
      // "!!!" normalises to null, so the design falls through to inference —
      // and this text names a fabric, not a garment, so the stand-in yields
      // its low-signal answer. Either way it must never be "!!!".
      expect(res.data.design.product_type).not.toBe("!!!");
      expect(res.data.design.product_type_source).not.toBe("manual");
    });

    it("still creates the design when the type cannot be determined", async () => {
      const res = await api.post(
        "/admin/designs",
        { ...baseDesign, name: "Indigo motif study" },
        headers
      );

      // 🔑 The design is the thing that must survive. A missing type is
      // recoverable; a design a designer could not save is not.
      expect(res.status).toBe(201);
      expect(res.data.design.id).toBeTruthy();
      expect(res.data.design.name).toBe("Indigo motif study");
    });
  });

  describe("POST /admin/designs/:id/product-type — re-inference", () => {
    it("does not overwrite a manually set type", async () => {
      const created = await api.post(
        "/admin/designs",
        { ...baseDesign, name: "Summer Trousers", product_type: "palazzo" },
        headers
      );
      const id = created.data.design.id;
      expect(created.data.design.product_type).toBe("palazzo");

      const res = await api.post(
        `/admin/designs/${id}/product-type`,
        {},
        headers
      );

      expect(res.status).toBe(200);
      expect(res.data.inference.skipped).toBe(true);
      expect(res.data.inference.skip_reason).toBe("manually_set");
      // The designer said palazzo. It is still palazzo.
      expect(res.data.design.product_type).toBe("palazzo");
      expect(res.data.design.product_type_source).toBe("manual");
    });

    it("overwrites a manual type only when force is passed", async () => {
      const created = await api.post(
        "/admin/designs",
        { ...baseDesign, name: "Summer Trousers", product_type: "palazzo" },
        headers
      );
      const id = created.data.design.id;

      const res = await api.post(
        `/admin/designs/${id}/product-type`,
        { force: true },
        headers
      );

      expect(res.status).toBe(200);
      expect(res.data.inference.skipped).toBe(false);
      expect(res.data.design.product_type).toBe("trousers");
      expect(res.data.design.product_type_source).toBe("inferred");
    });

    it("does not re-spend a model call on an already-inferred type", async () => {
      const created = await api.post(
        "/admin/designs",
        { ...baseDesign, name: "Summer Trousers" },
        headers
      );
      const id = created.data.design.id;
      expect(created.data.design.product_type).toBe("trousers");

      const res = await api.post(
        `/admin/designs/${id}/product-type`,
        {},
        headers
      );

      expect(res.data.inference.skipped).toBe(true);
      expect(res.data.inference.skip_reason).toBe("already_set");
    });

    it("404s on an unknown design instead of reporting a skip as success", async () => {
      const res = await api
        .post("/admin/designs/design_does_not_exist/product-type", {}, headers)
        .catch((err) => err.response);

      expect(res.status).toBe(404);
    });
  });

  describe("POST /admin/designs/:id — correcting the type by hand", () => {
    it("stamps an updated type as manual so inference stops touching it", async () => {
      const created = await api.post(
        "/admin/designs",
        { ...baseDesign, name: "Summer Trousers" },
        headers
      );
      const id = created.data.design.id;
      expect(created.data.design.product_type_source).toBe("inferred");

      const updated = await api.put(
        `/admin/designs/${id}`,
        { product_type: "Palazzo" },
        headers
      );

      expect(updated.status).toBe(200);
      expect(updated.data.design.product_type).toBe("palazzo");
      expect(updated.data.design.product_type_source).toBe("manual");

      // And the correction sticks against a plain re-infer.
      const reinfer = await api.post(
        `/admin/designs/${id}/product-type`,
        {},
        headers
      );
      expect(reinfer.data.design.product_type).toBe("palazzo");
    });

    it("clears the type and hands it back to inference when set to null", async () => {
      const created = await api.post(
        "/admin/designs",
        { ...baseDesign, name: "Summer Trousers", product_type: "palazzo" },
        headers
      );
      const id = created.data.design.id;

      const cleared = await api.put(
        `/admin/designs/${id}`,
        { product_type: null },
        headers
      );
      expect(cleared.data.design.product_type).toBeNull();
      expect(cleared.data.design.product_type_source).toBeNull();

      const reinfer = await api.post(
        `/admin/designs/${id}/product-type`,
        {},
        headers
      );
      expect(reinfer.data.inference.skipped).toBe(false);
      expect(reinfer.data.design.product_type).toBe("trousers");
    });
  });
});
