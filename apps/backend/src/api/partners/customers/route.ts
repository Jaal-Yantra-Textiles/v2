import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { getPartnerStore, tryGetPartnerStore } from "../helpers"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { store } = await tryGetPartnerStore(req.auth_context, req.scope)
  if (!store) {
    return res.json({ customers: [], count: 0, offset: 0, limit: 20 })
  }

  const qv = (req.validatedQuery ?? req.query ?? {}) as Record<string, any>
  const q = typeof qv.q === "string" ? qv.q.trim() : ""
  const limit = Number.isFinite(Number(qv.limit)) ? Number(qv.limit) : 20
  const offset = Number.isFinite(Number(qv.offset)) ? Number(qv.offset) : 0

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "stores",
    fields: ["customers.*"],
    filters: { id: store.id },
  })

  const customers = (data?.[0] as any)?.customers || []

  // Apply free-text search (q) against email/name/company/phone. The
  // store→customers link join above can't filter on these, so we
  // post-filter in-app (same approach as the inventory-items route).
  // Without this the partner UI search box silently returns the full
  // list (#484).
  const needle = q.toLowerCase()
  const matched = needle
    ? customers.filter((c: any) => {
        const candidates: Array<string | undefined> = [
          c?.email,
          c?.first_name,
          c?.last_name,
          [c?.first_name, c?.last_name].filter(Boolean).join(" ") || undefined,
          c?.company_name,
          c?.phone,
        ]
        return candidates.some(
          (v) => typeof v === "string" && v.toLowerCase().includes(needle)
        )
      })
    : customers

  // Respect offset/limit pagination so the UI's page controls work.
  const safeOffset = offset > 0 ? offset : 0
  const safeLimit = limit > 0 ? limit : matched.length
  const paginated = matched.slice(safeOffset, safeOffset + safeLimit)

  res.json({
    customers: paginated,
    count: matched.length,
    offset: safeOffset,
    limit: safeLimit,
  })
}

/**
 * Add a buyer to the partner's store (#1515).
 *
 * ## Why this is not just `createCustomers`
 *
 * Core's unique index on `customer` is `(email, has_account)` and it is
 * PLATFORM-WIDE. This route used to create unconditionally, so a partner
 * adding a buyer who already existed anywhere on the platform got core's raw
 * 400 — a message naming another store's data, surfaced verbatim in the
 * partner UI. #1507 documented the same collision on the mint path and fixed
 * it there; this is the other half.
 *
 * ## Adopt, and SAY SO
 *
 * The buyer is resolved in the same three steps the mint uses:
 *
 *   1. already one of this store's customers — nothing to do;
 *   2. an existing platform-wide row, ADOPTED into this store by a link;
 *   3. nobody — create them.
 *
 * 🔑 Step 2 answers with `adopted: true` rather than a bare 200, because the
 * honest description of what happened is "you acquired someone else's existing
 * record", not "you created a customer". The distinction is visible in the
 * result: the fields the partner just typed are NOT written onto an adopted
 * profile. Overwriting another store's `first_name` and `phone` with what this
 * partner guessed would be a silent cross-tenant edit, and answering 201 while
 * doing it would tell them they had created the row they are looking at.
 *
 * ⚠️ Adoption is a real disclosure either way: the customer then appears on
 * `GET /partners/customers` carrying whatever profile another store collected.
 * That is deliberate, and the alternative — #1507's world — was that the
 * platform's highest-value buyers could not be added or quoted at all.
 *
 * 🔑 The lookup is an EXACT match on the normalised address, matching the
 * mint's reasoning: core's index compares the stored string, so an exact
 * lookup covers exactly the set of rows a create could collide with. Anything
 * looser would adopt a customer core would have let us create alongside.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { store } = await getPartnerStore(req.auth_context, req.scope)

  const body = (req.body ?? {}) as Record<string, any>
  const email = String(body.email ?? "").trim().toLowerCase()
  if (!email) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "A customer needs an email address."
    )
  }

  const customerService = req.scope.resolve(Modules.CUSTOMER) as any
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as any
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // 1. Already this store's customer.
  const { data: storeRows } = await query.graph({
    entity: "stores",
    fields: ["customers.id", "customers.email"],
    filters: { id: store.id },
  })
  const mine = (((storeRows ?? [])[0] as any)?.customers ?? []) as any[]
  const alreadyOurs = mine.find(
    (c) => String(c?.email ?? "").toLowerCase() === email
  )
  if (alreadyOurs) {
    const [full] = await customerService.listCustomers({ id: alreadyOurs.id })
    return res.json({
      customer: full ?? alreadyOurs,
      adopted: false,
      already_in_store: true,
    })
  }

  // 2. Somebody else's, platform-wide. Adopt them, and say so.
  const existing: any[] = await customerService
    .listCustomers({ email }, { take: 10 })
    .catch(() => [])
  /**
   * A registered account OUTRANKS a guest with the same address, because the
   * unique index is on the PAIR — both rows can exist for one person, and the
   * one the buyer sees when they sign in is the account (#1507).
   */
  const adoptee = existing.find((c) => c?.has_account) ?? existing[0]

  if (adoptee) {
    await remoteLink.create({
      [Modules.STORE]: { store_id: store.id },
      [Modules.CUSTOMER]: { customer_id: adoptee.id },
    })
    return res.json({ customer: adoptee, adopted: true })
  }

  // 3. Nobody by that address. Create them.
  const customer = await customerService.createCustomers({
    ...body,
    email,
  })
  await remoteLink.create({
    [Modules.STORE]: { store_id: store.id },
    [Modules.CUSTOMER]: { customer_id: customer.id },
  })

  res.status(201).json({ customer, adopted: false })
}
