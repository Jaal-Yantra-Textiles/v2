import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user";
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup";

jest.setTimeout(60000);

/**
 * API integration test for the #771/#788 inventory-order status flow installer.
 *
 * #788 shipped the FLOW_DEF + the `install-inventory-order-status-flow`
 * Data-Plumbing job with UNIT tests only (FLOW_DEF structure + summary wording).
 * This exercises the real admin API end-to-end:
 *   POST /admin/ops/maintenance-jobs/install-inventory-order-status-flow/run
 * asserting dry-run previews without writing, apply creates the event-triggered
 * DRAFT flow in the DB, and a re-run is idempotent.
 */
const JOB_ID = "install-inventory-order-status-flow";
const FLOW_NAME = "Partner WhatsApp — Inventory Order Status";
const EVENT = "inventory_orders.inventory-order.status-changed";
const VISUAL_FLOWS_MODULE = "visual_flows";
const RUN_URL = `/admin/ops/maintenance-jobs/${JOB_ID}/run`;

setupSharedTestSuite(() => {
  let headers;
  const { api, getContainer } = getSharedTestEnv();

  const flowService = () => getContainer().resolve(VISUAL_FLOWS_MODULE) as any;
  const findFlow = async () => {
    const [flow] = await flowService().listVisualFlows({ name: FLOW_NAME });
    return flow;
  };
  const deleteFlowIfExists = async () => {
    const flow = await findFlow();
    if (flow) await flowService().deleteVisualFlows(flow.id);
  };

  beforeEach(async () => {
    await createAdminUser(getContainer());
    headers = await getAuthHeaders(api);
  });

  afterAll(async () => {
    try {
      await deleteFlowIfExists();
    } catch {
      /* best-effort cleanup */
    }
  });

  describe("#788 — install-inventory-order-status-flow data-plumbing job", () => {
    it("dry-run previews, apply creates the event-triggered draft, re-run is idempotent", async () => {
      // Clean slate (the shared DB may carry a flow from a prior run).
      await deleteFlowIfExists();

      // 1) dry-run: previews, writes nothing.
      const dry = await api.post(RUN_URL, { dry_run: true }, headers);
      expect(dry.status).toBe(200);
      expect(dry.data.result.job_id).toBe(JOB_ID);
      expect(dry.data.result.applied).toBe(false);
      expect(dry.data.result.summary).toMatch(/would create/i);
      expect(await findFlow()).toBeFalsy();

      // 2) apply: creates the flow.
      const apply = await api.post(RUN_URL, { dry_run: false }, headers);
      expect(apply.status).toBe(200);
      expect(apply.data.result.applied).toBe(true);
      expect(apply.data.result.summary).toMatch(/created/i);

      const flow = await findFlow();
      expect(flow).toBeTruthy();
      expect(flow.name).toBe(FLOW_NAME);
      expect(flow.status).toBe("draft");
      expect(flow.trigger_type).toBe("event");
      expect(flow.trigger_config?.event_types).toContain(EVENT);

      // 3) re-run apply: idempotent, never overwrites.
      const again = await api.post(RUN_URL, { dry_run: false }, headers);
      expect(again.status).toBe(200);
      expect(again.data.result.applied).toBe(false);
      expect(again.data.result.summary).toMatch(/already installed/i);

      // Still exactly one flow with this name.
      const all = await flowService().listVisualFlows({ name: FLOW_NAME });
      expect(all.length).toBe(1);
    });

    it("returns 404 for an unknown job id", async () => {
      const res = await api
        .post(`/admin/ops/maintenance-jobs/not-a-real-job/run`, { dry_run: true }, headers)
        .catch((e) => e.response);
      expect(res.status).toBe(404);
    });

    it("requires admin auth", async () => {
      const res = await api
        .post(RUN_URL, { dry_run: true })
        .catch((e) => e.response);
      expect([401, 403]).toContain(res.status);
    });
  });
});
