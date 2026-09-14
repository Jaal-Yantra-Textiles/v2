/**
 * #2029 item 2 — the house store is identified by the partner↔store LINK, not
 * by `store.metadata.partner_id`.
 *
 * 🔑 Why this has to be an integration test. A unit test can assert
 * `pickHouseStore` prefers a set of ids, but it cannot prove that the link
 * `create-store-with-defaults` writes is the same relation `readHouseStore`
 * reads back — `defineLink` registers as an import side effect and a
 * `query.graph` hop that names the wrong thing returns EMPTY rather than
 * throwing. An empty result here is indistinguishable from "no store belongs to
 * a partner", which is exactly the failure mode being designed against, so the
 * only honest proof is a real store created through the real route.
 *
 * The test deliberately STRIPS `metadata.partner_id` after creation. With the
 * blob gone the old read sees two ownerless stores, calls that ambiguous and
 * returns null — which silently disables the currency gate. If the link is
 * genuinely being read, the house store still resolves.
 *
 * Run:
 *   pnpm test:integration:http:shared ./integration-tests/http/house-store-partner-link
 */

import { Modules } from "@medusajs/framework/utils"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { deletePartnerWorkflow } from "../../src/workflows/partners/delete-partner"
import {
  pickHouseStore,
  readHouseStore,
} from "../../src/workflows/production-runs/house-store"

const PARTNER_PASSWORD = "supersecret"
jest.setTimeout(180_000)

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("house store resolution (#2029 item 2)", () => {
    let adminHeaders: Record<string, any>

    beforeEach(async () => {
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)
    })

    it("identifies the house store from the link, with the metadata tag removed", async () => {
      const unique = Date.now() + Math.random().toString(36).slice(2, 6)
      const email = `house-${unique}@jyt.test`

      await api.post("/auth/partner/emailpass/register", {
        email,
        password: PARTNER_PASSWORD,
      })
      let login = await api.post("/auth/partner/emailpass", {
        email,
        password: PARTNER_PASSWORD,
      })
      let headers: Record<string, string> = {
        Authorization: `Bearer ${login.data.token}`,
      }
      const partnerRes = await api.post(
        "/partners",
        {
          name: `House Partner ${unique}`,
          handle: `housepartner-${unique}`,
          admin: { email, first_name: "House", last_name: "Partner" },
        },
        { headers }
      )
      const partnerId = partnerRes.data.partner.id as string
      login = await api.post("/auth/partner/emailpass", {
        email,
        password: PARTNER_PASSWORD,
      })
      headers = { Authorization: `Bearer ${login.data.token}` }

      const currenciesRes = await api.get("/admin/currencies", adminHeaders)
      const currencies = currenciesRes.data.currencies || []
      const usd = currencies.find((c: any) => c.code?.toLowerCase() === "usd")
      const currencyCode = String((usd || currencies[0]).code).toLowerCase()

      // The real route: writes the partner↔store link AND the metadata tag.
      const storeRes = await api.post(
        "/partners/stores",
        {
          store: {
            name: `House Test Store ${unique}`,
            supported_currencies: [
              { currency_code: currencyCode, is_default: true },
            ],
          },
          sales_channel: { name: `HS Channel ${unique}`, description: "Default" },
          region: {
            name: "Default Region",
            currency_code: currencyCode,
            countries: ["us"],
          },
          location: {
            name: "Warehouse",
            address: {
              address_1: "1 Main St",
              city: "NY",
              postal_code: "10001",
              country_code: "US",
            },
          },
        },
        { headers }
      )
      expect(storeRes.status).toBe(201)
      const partnerStoreId = storeRes.data.store.id as string

      const container = getContainer()

      // Strip the blob. From here the ONLY thing that can identify this store as
      // a partner's is the link.
      const storeService: any = container.resolve(Modules.STORE)
      await storeService.updateStores(partnerStoreId, { metadata: {} })

      // Control: the old, blob-only rule can no longer answer. Two ownerless
      // stores is ambiguous, and ambiguity turns the currency gate off.
      const { data: rawStores } = await (
        container.resolve("query") as any
      ).graph({ entity: "store", fields: ["id", "metadata"] })
      const blobOnly = pickHouseStore(rawStores)
      expect(rawStores.map((s: any) => s.id)).toContain(partnerStoreId)
      expect(blobOnly).toBeNull()

      // The link still knows.
      const house = await readHouseStore(container)
      expect(house).not.toBeNull()
      expect(house!.id).not.toBe(partnerStoreId)

      /**
       * Deleting the partner must not make its store look ownerless.
       *
       * ⚠️ This assertion is DELIBERATELY weak, and the reason is worth
       * recording. `resolveBrandLocationId` carries a comment describing a real
       * prod incident: a soft-deleted partner kept its store and its link, the
       * store looked ownerless, and the brand-store heuristic threw until
       * someone cleaned the orphan up by hand. That comment is why
       * `readHouseStore` reads partners `withDeleted`.
       *
       * It could not be reproduced here, and probing said why:
       *   · `deletePartnerWorkflow` now deletes the partner's STORE as well —
       *     after the call only the seed store is left.
       *   · and for the soft-deleted partner row that remains, the `stores.id`
       *     hop comes back EMPTY even WITH `withDeleted: true`.
       *
       * So the orphan this guards against is no longer produced by this path,
       * and `withDeleted` could not recover the link if it were. Both halves are
       * asserted below so that if either changes back, this says so.
       */
      await deletePartnerWorkflow(container).run({ input: { id: partnerId } })

      const q: any = container.resolve("query")
      const { data: storesAfter } = await q.graph({
        entity: "store",
        fields: ["id"],
      })
      expect(storesAfter.map((x: any) => x.id)).not.toContain(partnerStoreId)

      const { data: deletedPartners } = await q.graph({
        entity: "partners",
        fields: ["id", "deleted_at", "stores.id"],
        withDeleted: true,
      })
      const gone = deletedPartners.find((x: any) => x.id === partnerId)
      expect(gone?.deleted_at).toBeTruthy()
      // The hop is empty even with `withDeleted` — see the note above.
      expect(gone?.stores ?? []).toEqual([])

      // The house store is still the same store, still unambiguous.
      const afterDelete = await readHouseStore(container)
      expect(afterDelete).not.toBeNull()
      expect(afterDelete!.id).toBe(house!.id)
    })
  })
})
