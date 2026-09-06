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
 * 🔴 Nothing here offers a `remove`, and that is a decision rather than an
 * omission. Detaching a partner's work is not the mirror of detaching a
 * design's: a run belongs to the design that ordered it, a submission is a
 * financial record, a payment method may already have been paid to, and a
 * person may be linked from either side. Every one of those has a route of its
 * own with its own guards; surfacing a bin icon here would either duplicate
 * that logic or bypass it.
 *
 * The rows are worth listing regardless — "which four designs?" is exactly the
 * question the count provokes, and answering it is most of what the drawer is
 * for.
 */

const designItems = async (query: any, partnerId: string): Promise<NodeItem[]> => {
  const { data: links } = await query.graph({
    entity: designPartnersLink.entryPoint,
    filters: { partner_id: partnerId },
    fields: ["design_id"],
  })
  const ids = asArray<any>(links).map((l) => l.design_id).filter(Boolean)
  if (!ids.length) return []

  const { data: designs } = await query.graph({
    entity: "designs",
    filters: { id: ids },
    fields: ["id", "name", "status", "design_type", "priority"],
  })

  return asArray<any>(designs).map((d) => ({
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
    ],
    remove: null,
  }))
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

  return asArray<any>(people).map((p) => ({
    id: String(p.id),
    label: [p.first_name, p.last_name].filter(Boolean).join(" ") || String(p.id),
    sublabel: p.email ? String(p.email) : null,
    status: null,
    href: `/persons/${p.id}`,
    props: p.email ? [{ key: "email", value: String(p.email) }] : [],
    remove: null,
  }))
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
