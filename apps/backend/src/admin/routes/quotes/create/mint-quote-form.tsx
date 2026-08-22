import {
  Button,
  Heading,
  Input,
  Label,
  ProgressStatus,
  ProgressTabs,
  Select,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import { useMemo, useState } from "react"

import { usePartners } from "../../../hooks/api/partners"
import { useProducts } from "../../../hooks/api/products"
import {
  QuoteReadiness,
  useAdminQuoteReadiness,
  useMintQuote,
} from "../../../hooks/api/quotes"
import { MintedPanel } from "./minted-panel"
import { ReadinessPanel } from "./readiness-panel"

type Line = { variant_id: string; quantity: number }

/**
 * Mint a quote on a partner's behalf (#1419, stepped in #1444).
 *
 * ## Why steps
 *
 * The partner mints through a three-step wizard and the admin filled in one
 * long form; the two are meant to feel like the same product. This mirrors the
 * partner's `ProgressTabs` shape with one extra LEADING step — Partner —
 * because an admin has no partner of their own and every quote is
 * partner-scoped.
 *
 * **Partner → Buyer → Lines → Review & mint.**
 *
 * 🔑 Ordering is not cosmetic. The partner decides which catalogue the variants
 * come from and which location freight is quoted from, so choosing variants
 * before a partner would let an admin build a basket that is then rejected
 * wholesale. Each step gates the next.
 *
 * ⚠️ Deliberately still `useState` rather than a react-hook-form + zod port.
 * The partner wizard uses that stack, but porting the form plumbing here would
 * rewrite every field at the same time as changing the flow, and this surface
 * has never been run through a browser. Steps and gating are the part that was
 * missing; the plumbing can follow once someone has clicked through it.
 */

enum Tab {
  PARTNER = "partner",
  BUYER = "buyer",
  LINES = "lines",
  REVIEW = "review",
}

const tabOrder = [Tab.PARTNER, Tab.BUYER, Tab.LINES, Tab.REVIEW] as const

export const MintQuoteForm = () => {
  const [tab, setTab] = useState<Tab>(Tab.PARTNER)
  const [tabState, setTabState] = useState<Record<Tab, ProgressStatus>>({
    [Tab.PARTNER]: "in-progress",
    [Tab.BUYER]: "not-started",
    [Tab.LINES]: "not-started",
    [Tab.REVIEW]: "not-started",
  })

  const [partnerId, setPartnerId] = useState("")
  const [buyerEmail, setBuyerEmail] = useState("")
  const [company, setCompany] = useState("")
  const [name, setName] = useState("")
  const [note, setNote] = useState("")
  const [country, setCountry] = useState("in")
  const [postal, setPostal] = useState("")
  const [currency, setCurrency] = useState("inr")
  const [ttlDays, setTtlDays] = useState("14")
  const [lines, setLines] = useState<Line[]>([])
  const [readiness, setReadiness] = useState<QuoteReadiness | null>(null)
  const [minted, setMinted] = useState<{ token: string; quote: any } | null>(
    null
  )

  const { partners } = usePartners({ limit: 200 } as any)
  const { products } = useProducts({ limit: 100 } as any)

  const variantOptions = useMemo(() => {
    const out: Array<{ id: string; label: string }> = []
    for (const p of (products ?? []) as any[]) {
      for (const v of p.variants ?? []) {
        out.push({ id: v.id, label: `${p.title} — ${v.title}` })
      }
    }
    return out
  }, [products])

  const { mutate: mint, isPending } = useMintQuote({
    onSuccess: (data) => setMinted({ token: data.token, quote: data.quote }),
    onError: (e: any) => toast.error(e?.message ?? "Could not mint the quote."),
  })

  const { mutateAsync: checkReadiness, isPending: isChecking } =
    useAdminQuoteReadiness()

  // The panel REPLACES the form rather than sitting beside it. The token is
  // shown once and never again, so anything that invites navigating away
  // before copying it is a way to lose a quote.
  if (minted) {
    return <MintedPanel token={minted.token} quote={minted.quote} />
  }

  const validLines = lines.filter((l) => l.variant_id && l.quantity > 0)

  /** What each step needs before the next one is reachable. */
  const stepComplete: Record<Tab, boolean> = {
    [Tab.PARTNER]: !!partnerId,
    [Tab.BUYER]: !!buyerEmail && !!currency && !!country,
    [Tab.LINES]: validLines.length > 0,
    [Tab.REVIEW]: true,
  }

  const stepHint: Record<Tab, string> = {
    [Tab.PARTNER]: "Choose the partner this quote belongs to.",
    [Tab.BUYER]:
      "A buyer email, a currency and a destination country are the minimum — the currency and destination decide the price and the freight.",
    [Tab.LINES]: "Add at least one line with a quantity above zero.",
    [Tab.REVIEW]: "",
  }

  const goToTab = (next: Tab) => {
    const targetIndex = tabOrder.indexOf(next)
    const currentIndex = tabOrder.indexOf(tab)

    // Going back is always allowed. Going forward validates every step in
    // between, so a tab cannot be skipped by clicking its header.
    if (targetIndex > currentIndex) {
      for (let i = 0; i < targetIndex; i++) {
        const step = tabOrder[i]
        if (!stepComplete[step]) {
          toast.error(stepHint[step])
          setTab(step)
          return
        }
      }
    }

    setTabState((prev) => ({
      ...prev,
      ...(targetIndex > currentIndex
        ? { [tab]: "completed" as ProgressStatus }
        : {}),
      [next]: "in-progress" as ProgressStatus,
    }))
    setTab(next)
  }

  const handleNext = () => {
    const i = tabOrder.indexOf(tab)
    if (i === tabOrder.length - 1) return
    goToTab(tabOrder[i + 1])
  }

  const payload = () => ({
    partner_id: partnerId,
    lines: validLines,
    destination_country_code: country,
    destination_postal_code: postal || null,
    currency_code: currency,
  })

  /**
   * The preflight, then the mint (#1445).
   *
   * 🔑 Run on submit rather than on every field change: it prices every line
   * and asks a carrier, which is not a thing to fire per keystroke.
   *
   * 🔑 A preflight that cannot RUN does not block the mint. The workflow runs
   * the same assessor as its first step, so the real gate is there either way,
   * and failing closed here would turn a network blip into "you cannot quote".
   */
  const submit = async () => {
    let assessed: QuoteReadiness | null = null
    try {
      const result = await checkReadiness(payload())
      assessed = result.readiness
      setReadiness(result.readiness)
    } catch {
      setReadiness(null)
    }

    if (assessed && !assessed.ready) {
      toast.error("This quote cannot be minted yet — see the reasons above.")
      return
    }

    mint({
      partner_id: partnerId,
      buyer_email: buyerEmail,
      recipient_company: company || null,
      recipient_name: name || null,
      partner_note: note || null,
      lines: validLines,
      destination_country_code: country,
      destination_postal_code: postal || null,
      currency_code: currency,
      ttl_days: Number(ttlDays) || undefined,
    })
  }

  const addLine = () =>
    setLines((prev) => [...prev, { variant_id: "", quantity: 1 }])

  const isLast = tab === Tab.REVIEW

  return (
    <div className="flex flex-col">
      <div className="px-6 pt-6">
        <Heading>Mint a quote</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          The buyer link is shown once and cannot be recovered — you will be
          asked to copy it before leaving this page.
        </Text>
      </div>

      <ProgressTabs
        value={tab}
        onValueChange={(v) => goToTab(v as Tab)}
        className="flex flex-col"
      >
        <div className="border-ui-border-base border-b px-6 py-4">
          <ProgressTabs.List className="grid w-full max-w-[640px] grid-cols-4">
            <ProgressTabs.Trigger
              status={tabState[Tab.PARTNER]}
              value={Tab.PARTNER}
            >
              Partner
            </ProgressTabs.Trigger>
            <ProgressTabs.Trigger
              status={tabState[Tab.BUYER]}
              value={Tab.BUYER}
            >
              Buyer
            </ProgressTabs.Trigger>
            <ProgressTabs.Trigger
              status={tabState[Tab.LINES]}
              value={Tab.LINES}
            >
              Lines
            </ProgressTabs.Trigger>
            <ProgressTabs.Trigger
              status={tabState[Tab.REVIEW]}
              value={Tab.REVIEW}
            >
              Review
            </ProgressTabs.Trigger>
          </ProgressTabs.List>
        </div>

        <ProgressTabs.Content value={Tab.PARTNER} className="px-6 py-6">
          <div className="flex max-w-[640px] flex-col gap-y-2">
            <Label>Partner</Label>
            <Select value={partnerId} onValueChange={setPartnerId}>
              <Select.Trigger>
                <Select.Value placeholder="Select a partner" />
              </Select.Trigger>
              <Select.Content>
                {((partners ?? []) as any[]).map((p) => (
                  <Select.Item key={p.id} value={p.id}>
                    {p.name || p.id}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
            <Text size="xsmall" className="text-ui-fg-subtle">
              Prices come from this partner's catalogue and freight from their
              location. Variants outside their store are rejected — that check
              is why this step comes first.
            </Text>
          </div>
        </ProgressTabs.Content>

        <ProgressTabs.Content value={Tab.BUYER} className="px-6 py-6">
          <div className="grid max-w-[860px] grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-y-2">
              <Label>Buyer email</Label>
              <Input
                type="email"
                value={buyerEmail}
                onChange={(e) => setBuyerEmail(e.target.value)}
                placeholder="procurement@example.com"
              />
            </div>
            <div className="flex flex-col gap-y-2">
              <Label>Company</Label>
              <Input
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-y-2">
              <Label>Contact name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-y-2">
              <Label>Currency</Label>
              <Input
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toLowerCase())}
                placeholder="inr"
              />
            </div>
            <div className="flex flex-col gap-y-2">
              <Label>Destination country (ISO-2)</Label>
              <Input
                value={country}
                onChange={(e) => setCountry(e.target.value.toLowerCase())}
                placeholder="in"
              />
            </div>
            <div className="flex flex-col gap-y-2">
              <Label>Destination postcode</Label>
              <Input
                value={postal}
                onChange={(e) => setPostal(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-y-2">
              <Label>Valid for (days)</Label>
              <Input
                type="number"
                value={ttlDays}
                onChange={(e) => setTtlDays(e.target.value)}
              />
              <Text size="xsmall" className="text-ui-fg-subtle">
                Drives the price list's end date, so expiry is enforced by
                pricing itself rather than by a sweep.
              </Text>
            </div>
          </div>
        </ProgressTabs.Content>

        <ProgressTabs.Content value={Tab.LINES} className="px-6 py-6">
          <div className="flex max-w-[860px] flex-col gap-y-3">
            <div className="flex items-center justify-between">
              <Label>Lines</Label>
              <Button variant="secondary" size="small" onClick={addLine}>
                Add line
              </Button>
            </div>
            {lines.length === 0 ? (
              <Text size="small" className="text-ui-fg-subtle">
                A quote is a basket — add at least one line. Multiple lines are
                quoted as ONE consignment, so freight is charged once.
              </Text>
            ) : null}
            {lines.map((line, i) => (
              <div key={i} className="flex items-end gap-3">
                <div className="flex flex-1 flex-col gap-y-2">
                  <Select
                    value={line.variant_id}
                    onValueChange={(v) =>
                      setLines((prev) =>
                        prev.map((l, idx) =>
                          idx === i ? { ...l, variant_id: v } : l
                        )
                      )
                    }
                  >
                    <Select.Trigger>
                      <Select.Value placeholder="Select a variant" />
                    </Select.Trigger>
                    <Select.Content>
                      {variantOptions.map((v) => (
                        <Select.Item key={v.id} value={v.id}>
                          {v.label}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select>
                </div>
                <div className="w-28">
                  <Input
                    type="number"
                    min={1}
                    value={line.quantity}
                    onChange={(e) =>
                      setLines((prev) =>
                        prev.map((l, idx) =>
                          idx === i
                            ? { ...l, quantity: Number(e.target.value) }
                            : l
                        )
                      )
                    }
                  />
                </div>
                <Button
                  variant="transparent"
                  size="small"
                  onClick={() =>
                    setLines((prev) => prev.filter((_, idx) => idx !== i))
                  }
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        </ProgressTabs.Content>

        <ProgressTabs.Content value={Tab.REVIEW} className="px-6 py-6">
          <div className="flex max-w-[860px] flex-col gap-y-4">
            {readiness && <ReadinessPanel readiness={readiness} />}

            <div className="flex flex-col gap-y-2">
              <Label>Note to the buyer</Label>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>

            <Text size="small" className="text-ui-fg-subtle">
              {validLines.length} line
              {validLines.length === 1 ? "" : "s"} · {currency.toUpperCase()} ·
              to {country.toUpperCase()}
              {postal ? ` ${postal}` : ""}. Minting runs a readiness check
              first — freight, weights and prices are verified before anything
              is created.
            </Text>
          </div>
        </ProgressTabs.Content>
      </ProgressTabs>

      <div className="border-ui-border-base flex items-center justify-end gap-x-2 border-t px-6 py-4">
        {isLast ? (
          <Button
            onClick={submit}
            disabled={!validLines.length || isPending || isChecking}
          >
            {isChecking ? "Checking…" : isPending ? "Minting…" : "Mint quote"}
          </Button>
        ) : (
          <Button onClick={handleNext} disabled={!stepComplete[tab]}>
            Continue
          </Button>
        )}
      </div>
    </div>
  )
}
