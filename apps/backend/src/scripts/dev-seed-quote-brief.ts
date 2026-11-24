/**
 * LOCAL ONLY (#2608): seed a multi-partner bag brief to click through.
 *
 *   DATABASE_URL=postgres://postgres@localhost:5432/medusa-jyt \
 *     npx medusa exec ./src/scripts/dev-seed-quote-brief.ts
 *
 * Creates (or reuses, by handle) a lead partner with its OWN store, sales
 * channel and publishable key, the step workshops named as on prod, their
 * samples and rates, then a brief, opens it, and prints the key + link.
 * Refuses to run against anything but localhost.
 */
import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { PARTNER_MODULE } from "../modules/partner"
import { PARTNER_CAPABILITY_MODULE } from "../modules/partner_capability"
import { PARTNER_QUOTE_MODULE } from "../modules/partner-quote"
import { generateQuoteToken, quoteExpiryFrom } from "../modules/partner-quote/lib/token"
import { createQuoteBriefWorkflow } from "../workflows/partner-quote/create-quote-brief"

export default async function seedQuoteBrief({ container }: ExecArgs) {
  const db = process.env.DATABASE_URL ?? ""
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(db)) {
    throw new Error("dev-seed-quote-brief only runs against a localhost DATABASE_URL")
  }
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const link: any = container.resolve(ContainerRegistrationKeys.LINK)
  const partners: any = container.resolve(PARTNER_MODULE)
  const capability: any = container.resolve(PARTNER_CAPABILITY_MODULE)
  const quotes: any = container.resolve(PARTNER_QUOTE_MODULE)
  const storeSvc: any = container.resolve(Modules.STORE)
  const channels: any = container.resolve(Modules.SALES_CHANNEL)
  const keys: any = container.resolve(Modules.API_KEY)

  const partner = async (handle: string, name: string, extra: Record<string, unknown> = {}) => {
    const [found] = await partners.listPartners({ handle })
    if (found) return found
    return partners.createPartners({ handle, name, status: "active", workspace_type: "manufacturer", ...extra })
  }

  // Lead: its own store, channel and key, so the tenant guard has exactly one store to find.
  const lead = await partner("local-brief-lead", "Saransh Sharma", { storefront_domain: "localhost:8000" })
  const { data: leadRows } = await container
    .resolve(ContainerRegistrationKeys.QUERY)
    .graph({ entity: "partners", fields: ["id", "stores.id"], filters: { id: lead.id } })
  let storeId: string | undefined = (leadRows as any[])[0]?.stores?.[0]?.id
  let token: string
  if (!storeId) {
    const channel = await channels.createSalesChannels({ name: "Local brief lead channel" })
    const store = await storeSvc.createStores({
      name: "Local brief lead store",
      default_sales_channel_id: channel.id,
      supported_currencies: [{ currency_code: "inr", is_default: true }],
    })
    storeId = store.id
    const key = await keys.createApiKeys({ title: "Local brief lead key", type: "publishable", created_by: "dev-seed" })
    token = key.token
    await link.create({ [Modules.API_KEY]: { publishable_key_id: key.id }, [Modules.SALES_CHANNEL]: { sales_channel_id: channel.id } })
    await link.create({ [PARTNER_MODULE]: { partner_id: lead.id }, [Modules.STORE]: { store_id: store.id } })
  } else {
    const [key] = await keys.listApiKeys({ title: "Local brief lead key", type: "publishable" })
    token = key.token
  }

  const gof = await partner("local-gof", "Ghosh and Organic Fashionary")
  const wfs = await partner("local-woven-fabric-studio", "Woven Fabric Studio")
  const akshit = await partner("local-akshit", "Akshit", { workspace_type: "individual" })
  const bodhi = await partner("local-bodhi", "Bodhi")
  const aarohi = await partner("local-aarohi", "Aarohi")
  const shramdaan = await partner("local-shramdaan", "Shramdaan")
  // Sharlho is the Dharamshala unit (prod 01K4PJMNMNRGMK0ZXMKBBDZDGD).
  const sharlho = await partner("local-sharlho", "Sharlho")

  const sample = async (p: any, title: string, technique: string, material: string | null, actions: string[]) => {
    const [found] = await capability.listPartnerCapabilitySamples({ partner_id: p.id, title })
    return found ?? capability.createPartnerCapabilitySamples({
      partner_id: p.id, title, technique, material, actions, source: "admin", captured_at: new Date(),
    })
  }
  const rate = async (p: any, technique: string, unit: string, low: number, high: number | null, extra: Record<string, unknown> = {}) => {
    const [found] = await capability.listPartnerCapabilityRates({ partner_id: p.id, technique })
    return found ?? capability.createPartnerCapabilityRates({
      partner_id: p.id, technique, unit, price_low: low, price_high: high, currency_code: "inr",
      tax_basis: "gst_exclusive", source: "from_past_runs", status: "confirmed", observed_at: new Date(), ...extra,
    })
  }

  const sGof = await sample(gof, "Handloom cotton canvas", "handloom", "cotton", ["weave"])
  const sWfs = await sample(wfs, "Handloom cotton fabric", "handloom", "cotton", ["weave"])
  const sAkshit = await sample(akshit, "Hand-painted comic-panel portraits", "hand painting", "paper", ["paint"])
  const sBodhiScreen = await sample(bodhi, "Hand screen printing (eco, pigment)", "screen printing", "cotton", ["print"])
  const sBodhiBlock = await sample(bodhi, "Hand block printing", "block printing", "cotton", ["print"])
  const sAarohi = await sample(aarohi, "Block printed cotton jacket", "block printed", "cotton", ["print"])
  const sShramdaan = await sample(shramdaan, "Bag making (structured / crossbody)", "stitching", "cotton", ["stitch"])
  const sSharlho = await sample(sharlho, "Handloom wool jacket", "stitching", "wool", ["stitch"])
  const sSharlho2 = await sample(sharlho, "Block printed cotton jacket", "stitching", "cotton", ["stitch"])

  const rGof = await rate(gof, "handloom_weaving", "metre", 150, null)
  const rWfs = await rate(wfs, "handloom_weaving", "metre", 281.82, null, { tax_basis: "unknown" })
  const rAkshit = await rate(akshit, "hand_painting", "piece", 500, 1500, { source: "partner_quoted", tax_basis: "unknown" })

  const fabric = {
    label: "Fabric", kind: "fabric" as const, technique: "handloom_weaving" as const, qty_per_piece: 0.6,
    note: "About 0.6 m of handloom cotton per bag",
    choices: [
      { partner_id: gof.id, rate_id: rGof.id, sample_ids: [sGof.id] },
      { partner_id: wfs.id, rate_id: rWfs.id, sample_ids: [sWfs.id] },
    ],
  }
  const stitching = {
    label: "Bag stitching", technique: "stitching" as const,
    choices: [
      { partner_id: sharlho.id, sample_ids: [sSharlho.id, sSharlho2.id], note: "Our unit in Dharamshala, good with bags" },
      { partner_id: shramdaan.id, sample_ids: [sShramdaan.id], note: "Non-leather only" },
    ],
  }

  const { result } = await createQuoteBriefWorkflow(container).run({
    input: {
      partner_id: lead.id,
      title: "Round crossbody bags, made by hand",
      intro:
        "Here are the ways we could make your bags, and the workshops who would make each part. Pick what you like, tell us a bit more, and we'll make 4 samples first.",
      destination_country_code: "au",
      currency_code: "inr",
      sample_quantity: 4,
      recipient_name: "RMIT buyer (local test)",
      options: [
        {
          title: "Hand-painted, non-leather",
          description: "Handloom cotton, painted by hand, stitched in India.",
          story: "Each bag carries a one-of-a-kind painting on cloth woven by hand, then stitched in a small workshop in the Himalayan foothills.",
          steps: [fabric, { label: "Hand painting", technique: "hand_painting", choices: [{ partner_id: akshit.id, rate_id: rAkshit.id, sample_ids: [sAkshit.id] }] }, stitching],
        },
        {
          title: "Screen or block printed, non-leather",
          story: "Hand-printed, one colour at a time, on handwoven cotton.",
          steps: [
            fabric,
            {
              label: "Screen or block print", technique: "block_print",
              choices: [
                { partner_id: bodhi.id, sample_ids: [sBodhiScreen.id, sBodhiBlock.id], note: "Screen print or hand block, eco pigments" },
                { partner_id: aarohi.id, sample_ids: [sAarohi.id], note: "Hand block print" },
              ],
            },
            stitching,
          ],
        },
        {
          title: "Digitally printed, non-leather",
          steps: [fabric, { label: "Digital print", technique: "digital_print", choices: [] }, stitching],
        },
        {
          title: "Leather crossbody",
          description: "Leather body with a painted panel.",
          steps: [
            { label: "Leather", kind: "fabric", choices: [] },
            { label: "Hand painting", technique: "hand_painting", choices: [{ partner_id: akshit.id, rate_id: rAkshit.id, sample_ids: [sAkshit.id] }] },
            { label: "Leather stitching", technique: "stitching", note: "Shramdaan doesn't do leather; a second workshop is needed", choices: [] },
          ],
        },
      ],
    } as any,
  })

  const { raw, hash } = generateQuoteToken()
  await quotes.updatePartnerQuoteBriefs({
    id: result.id, token_hash: hash, status: "open", opened_at: new Date(), expires_at: quoteExpiryFrom(new Date(), 60),
  })

  logger.info(`[dev-seed-quote-brief] brief ${result.id} (lead store ${storeId})`)
  logger.info(`[dev-seed-quote-brief] NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=${token}`)
  logger.info(`[dev-seed-quote-brief] BRIEF_TOKEN=${raw}`)
}
