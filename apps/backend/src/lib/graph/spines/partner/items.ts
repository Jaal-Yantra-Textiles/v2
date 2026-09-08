import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import designPartnersLink from "../../../../links/design-partners-link"
import partnerPaymentMethodsLink from "../../../../links/partner-payment-methods-link"
import partnerPersonLink from "../../../../links/partner-person"
import submissionPartnerLink from "../../../../links/submission-partner-link"
import { asArray } from "../../builder"
import type { NodeItem, SpineContext } from "../../types"

/**
 * The members behind a partner's aggregate nodes.
 *
 * 🔴 Only TWO of these offer a `remove`, and the split is the point (#1856).
 * Detaching a partner's work is not the blanket mirror of detaching a design's:
 * a run belongs to the design that ordered it, a submission is a financial
 * record, an order is history. A bin icon on those would either duplicate the
 * guards their own routes already run or bypass them.
 *
 * What DOES detach is the two relationships the partner is genuinely a party
 * to — the people linked to it, and its design assignments — and both name an
 * EXISTING admin endpoint rather than carrying unlink logic of their own.
 * `admins`, `payment_methods`, `submissions` and `runs` deliberately carry
 * none: the first two have no delete route at all (only `POST` and `PATCH`
 * exist), and inventing one here would put a destructive path in the graph
 * before it exists anywhere else.
 *
 * The rows are worth listing regardless — "which four designs?" is exactly the
 * question the count provokes, and answering it is most of what the drawer is
 * for.
 */

const s = (n: number, word: string) => (n === 1 ? word : `${word}s`)

const designItems = async (query: any, partnerId: string): Promise<NodeItem[]> => {
  const { data: links } = await query.graph({
    entity: designPartnersLink.entryPoint,
    filters: { partner_id: partnerId },
    fields: ["design_id"],
  })
  const ids = asArray<any>(links).map((l) => l.design_id).filter(Boolean)
  if (!ids.length) return []

  const [{ data: designs }, { data: runs }] = await Promise.all([
    query.graph({
      entity: "designs",
      filters: { id: ids },
      fields: ["id", "name", "status", "design_type", "priority"],
    }),
    /*
     * The partner's runs, so the confirm text can say what unlinking costs.
     * Filtered by partner rather than by design: this is the removal of THIS
     * partner from the design, and the design's other partners' runs are none
     * of its business.
     */
    query.graph({
      entity: "production_runs",
      filters: { partner_id: partnerId },
      fields: ["id", "design_id", "status"],
    }),
  ])

  const runList = asArray<any>(runs)

  return asArray<any>(designs).map((d) => {
    const live = runList.filter(
      (r) =>
        r.design_id === d.id &&
        !["cancelled", "completed"].includes(String(r.status))
    )
    return {
      id: String(d.id),
      label: String(d.name ?? d.id),
      sublabel:
        [d.design_type, d.priority ? `${d.priority} priority` : null]
          .filter(Boolean)
          .join(" · ") || null,
      status: d.status ? String(d.status) : null,
      href: `/designs/${d.id}`,
      props: [
        ...(d.design_type ? [{ key: "type", value: String(d.design_type) }] : []),
        ...(d.priority ? [{ key: "priority", value: String(d.priority) }] : []),
        { key: "live runs", value: String(live.length) },
      ],
      /*
       * 🔴 The SAME endpoint the design spine's partner row uses, with the two
       * ids swapped round. That is the whole reason this is safe to offer from
       * here: `cancel-partner-assignment` already verifies the partner is
       * linked, cancels their live runs and open tasks, and compensates. A
       * second unlink path for the same link table is exactly the fault
       * `delete-design` was carrying — one of twenty tables handled by name.
       *
       * 🔴 And it is NOT called "Unlink" when runs are live. The workflow
       * cancels production; a button whose label hides that is the worst thing
       * that could sit in this drawer, so the count is in the sentence.
       */
      remove: {
        method: "POST" as const,
        path: `/admin/designs/${d.id}/cancel-partner-assignment`,
        body: { partner_id: partnerId, unlink: true },
        label: live.length ? "Cancel assignment" : "Unlink",
        confirm: live.length
          ? `Cancel this partner's assignment on ${d.name || "this design"}? ${live.length} live ${s(live.length, "run")} of theirs and the open tasks on ${live.length === 1 ? "it" : "them"} are cancelled, and the partner is unlinked.`
          : `Unlink this partner from ${d.name || "this design"}? No live runs are affected.`,
      },
    }
  })
}

const runItems = async (query: any, partnerId: string): Promise<NodeItem[]> => {
  const { data: runs } = await query.graph({
    entity: "production_runs",
    filters: { partner_id: partnerId },
    fields: ["*"],
  })
  return asArray<any>(runs).map((r) => ({
    id: String(r.id),
    label: String(r.name || r.id),
    sublabel:
      [
        r.quantity_produced != null ? `${r.quantity_produced} produced` : null,
        r.execution_mode ? String(r.execution_mode) : null,
      ]
        .filter(Boolean)
        .join(" · ") || null,
    status: r.status ? String(r.status) : null,
    href: r.design_id ? `/designs/${r.design_id}/production-runs` : null,
    props: [
      { key: "status", value: String(r.status ?? "—") },
      ...(r.design_id ? [{ key: "design", value: String(r.design_id) }] : []),
    ],
    remove: null,
  }))
}

const submissionItems = async (
  query: any,
  partnerId: string
): Promise<NodeItem[]> => {
  const { data: links } = await query.graph({
    entity: submissionPartnerLink.entryPoint,
    filters: { partner_id: partnerId },
    fields: ["payment_submission_id"],
  })
  const ids = asArray<any>(links)
    .map((l) => l.payment_submission_id)
    .filter(Boolean)
  if (!ids.length) return []

  const { data: submissions } = await query.graph({
    entity: "payment_submission",
    filters: { id: ids },
    fields: ["*"],
  })

  return asArray<any>(submissions).map((sub) => ({
    id: String(sub.id),
    label: String(sub.reference ?? sub.id),
    sublabel:
      sub.amount != null
        ? `${String(sub.currency_code ?? "").toUpperCase()} ${sub.amount}`.trim()
        : null,
    status: sub.status ? String(sub.status) : null,
    href: `/payment-submissions`,
    props: [
      { key: "status", value: String(sub.status ?? "—") },
      ...(sub.amount != null ? [{ key: "amount", value: String(sub.amount) }] : []),
    ],
    remove: null,
  }))
}

const paymentMethodItems = async (
  query: any,
  partnerId: string
): Promise<NodeItem[]> => {
  const { data: links } = await query.graph({
    entity: partnerPaymentMethodsLink.entryPoint,
    filters: { partner_id: partnerId },
    fields: ["internal_payment_details_id"],
  })
  const ids = asArray<any>(links)
    .map((l) => l.internal_payment_details_id)
    .filter(Boolean)
  if (!ids.length) return []

  const { data: methods } = await query.graph({
    entity: "internal_payment_details",
    filters: { id: ids },
    fields: ["*"],
  })

  return asArray<any>(methods).map((m) => ({
    id: String(m.id),
    label: String(m.account_name || m.type || m.id),
    /*
     * 🔴 Never the account number. This drawer is a read of a relationship, not
     * a banking screen — the last four is enough to tell two accounts apart,
     * and it is all this view has any business rendering.
     */
    sublabel: m.account_number
      ? `•••• ${String(m.account_number).slice(-4)}`
      : (m.type ?? null),
    status: null,
    href: null,
    props: [...(m.type ? [{ key: "type", value: String(m.type) }] : [])],
    remove: null,
  }))
}

const peopleItems = async (query: any, partnerId: string): Promise<NodeItem[]> => {
  const { data: links } = await query.graph({
    entity: partnerPersonLink.entryPoint,
    filters: { partner_id: partnerId },
    fields: ["person_id"],
  })
  const ids = asArray<any>(links).map((l) => l.person_id).filter(Boolean)
  if (!ids.length) return []

  const { data: people } = await query.graph({
    entity: "person",
    filters: { id: ids },
    fields: ["id", "first_name", "last_name", "email"],
  })

  return asArray<any>(people).map((p) => {
    const name =
      [p.first_name, p.last_name].filter(Boolean).join(" ") || String(p.id)
    return {
      id: String(p.id),
      label: name,
      sublabel: p.email ? String(p.email) : null,
      status: null,
      href: `/persons/${p.id}`,
      props: p.email ? [{ key: "email", value: String(p.email) }] : [],
      /*
       * 🔴 A `DELETE` that carries a BODY. `/admin/partners/:id/people` takes
       * `{ person_ids }` on both POST and DELETE, and the admin's own unlink
       * hook has always sent it that way — so this is the route's real shape,
       * not a new one. It dismisses the link and leaves the person standing,
       * which is why the sentence says so out loud: the neighbouring row in
       * this same drawer ("Cancel assignment") does cancel real work, and the
       * two must not read alike.
       */
      remove: {
        method: "DELETE" as const,
        path: `/admin/partners/${partnerId}/people`,
        body: { person_ids: [String(p.id)] },
        label: "Unlink",
        confirm: `Unlink ${name} from this partner? The person record is untouched — they lose access to the partner's shared folders.`,
      },
    }
  })
}

const adminItems = async (query: any, partnerId: string): Promise<NodeItem[]> => {
  const { data: partners } = await query.graph({
    entity: "partners",
    filters: { id: partnerId },
    fields: ["id", "admins.*"],
  })
  const partner = (partners || [])[0]
  return asArray<any>(partner?.admins).map((a) => ({
    id: String(a.id),
    label: [a.first_name, a.last_name].filter(Boolean).join(" ") || String(a.email ?? a.id),
    sublabel: a.email ? String(a.email) : null,
    status: a.role ? String(a.role) : null,
    href: null,
    props: [
      ...(a.role ? [{ key: "role", value: String(a.role) }] : []),
      ...(a.email ? [{ key: "email", value: String(a.email) }] : []),
    ],
    remove: null,
  }))
}

const RESOLVERS: Record<
  string,
  (query: any, partnerId: string) => Promise<NodeItem[]>
> = {
  admins: adminItems,
  designs: designItems,
  runs: runItems,
  submissions: submissionItems,
  payment_methods: paymentMethodItems,
  people: peopleItems,
}

export const PARTNER_ITEM_NODES = Object.keys(RESOLVERS)

export const resolvePartnerItems = async (
  { scope, id }: SpineContext,
  nodeKey: string
): Promise<NodeItem[]> => {
  const resolver = RESOLVERS[nodeKey]
  if (!resolver) {
    return []
  }
  const query = scope.resolve(ContainerRegistrationKeys.QUERY) as any
  return resolver(query, id)
}
